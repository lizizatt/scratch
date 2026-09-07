"use strict";

/**
 * Simulation timeline recorder for the viz frontend.
 *
 * Attach to a world; samples character positions on clock advances and
 * drains per-character logs into a scrubbable event stream.
 *
 * Trace JSON shape (also consumed by viz/public):
 * {
 *   id, name, tags, durationMs,
 *   frames: [{ t, chars: { Name: { map,x,y,server,connected,hp,esize,gold } }, monsters? }],
 *   events: [{ t, who, kind, m, ... }],
 *   grades: { ... invariant counters }
 * }
 */

function attachTrace(world, opts) {
  opts = opts || {};
  const sampleMs = opts.sampleMs != null ? opts.sampleMs : 1000;
  const maxFrames = opts.maxFrames != null ? opts.maxFrames : 4000;
  const maxEvents = opts.maxEvents != null ? opts.maxEvents : 20000;

  const meta = {
    id: opts.id || "run",
    name: opts.name || opts.id || "run",
    tags: opts.tags || [],
  };

  const frames = [];
  const events = [];
  const logCursor = new Map(); // name -> { game, said, cm, server }
  let lastSampleAt = -Infinity;
  let stopped = false;

  function cursor(name) {
    if (!logCursor.has(name)) logCursor.set(name, { game: 0, said: 0, cm: 0, server: 0, path: 0 });
    return logCursor.get(name);
  }

  function pushEvent(ev) {
    if (events.length >= maxEvents) return;
    events.push(ev);
  }

  function drainLogs() {
    for (const [name, r] of world.roster) {
      const api = r.api;
      if (!api || !api.log) continue;
      const cur = cursor(name);
      const t = world.clock.now();
      const g = api.log.game || [];
      while (cur.game < g.length) {
        const row = g[cur.game++];
        pushEvent({ t: row.t != null ? row.t : t, who: name, kind: "log", m: row.m });
      }
      const said = api.log.said || [];
      while (cur.said < said.length) {
        pushEvent({ t, who: name, kind: "say", m: said[cur.said++] });
      }
      const cm = api.log.cm || [];
      while (cur.cm < cm.length) {
        const row = cm[cur.cm++];
        pushEvent({
          t,
          who: name,
          kind: "cm",
          to: row.to,
          m: typeof row.message === "object" ? JSON.stringify(row.message) : "" + row.message,
          receivers: row.receivers,
        });
      }
      const srv = api.log.server || [];
      while (cur.server < srv.length) {
        const pair = srv[cur.server++];
        pushEvent({ t, who: name, kind: "hop", to: pair });
      }
      const path = api.log.path || [];
      while (cur.path < path.length) {
        const row = path[cur.path++];
        pushEvent({
          t,
          who: name,
          kind: "move",
          m:
            (row.from && row.from.map) +
            "→" +
            (row.to && row.to.map) +
            " (" +
            Math.round((row.to && row.to.x) || 0) +
            "," +
            Math.round((row.to && row.to.y) || 0) +
            ") " +
            (row.ms || 0) +
            "ms",
          path: row,
        });
      }
    }
  }

  function snapshotMonsters() {
    // Best-effort: monsters live in server bags; expose via entities if present on farm map
    const out = [];
    for (const [name, r] of world.roster) {
      if (!r.api) continue;
      const ents = r.api.parent.entities || {};
      for (const id of Object.keys(ents)) {
        const e = ents[id];
        if (!e || e.type !== "monster" || e.dead) continue;
        if (out.some((m) => m.id === e.id)) continue;
        out.push({
          id: e.id,
          mtype: e.mtype,
          map: e.map,
          x: e.real_x != null ? e.real_x : e.x,
          y: e.real_y != null ? e.real_y : e.y,
        });
      }
      break; // one character's vision bag is enough for same-map farm
    }
    return out;
  }

  function sample(force) {
    if (stopped) return;
    const t = world.clock.now();
    if (!force && t - lastSampleAt < sampleMs) return;
    if (frames.length >= maxFrames) return;
    lastSampleAt = t;
    drainLogs();
    const chars = {};
    for (const [name, r] of world.roster) {
      const ch = r.api && r.api.character;
      if (!ch) continue;
      chars[name] = {
        map: ch.map,
        x: Math.round(ch.real_x != null ? ch.real_x : ch.x),
        y: Math.round(ch.real_y != null ? ch.real_y : ch.y),
        server: r.region + "/" + r.ident,
        connected: !!ch.connected,
        hp: ch.hp,
        esize: ch.esize,
        gold: ch.gold,
        ctype: ch.ctype,
      };
    }
    frames.push({ t, chars, monsters: snapshotMonsters() });
  }

  world.clock.onAdvance((now, ms) => {
    if (stopped) return;
    // Always drain logs; force a position sample on large jumps (owed travel).
    drainLogs();
    if ((ms | 0) >= sampleMs) sample(true);
    else sample(false);
  });

  // Initial frame
  sample(true);

  return {
    meta,
    sample() {
      sample(true);
    },
    stop() {
      stopped = true;
      sample(true);
      drainLogs();
    },
    toJSON(extra) {
      drainLogs();
      return Object.assign(
        {
          id: meta.id,
          name: meta.name,
          tags: meta.tags,
          durationMs: world.clock.now(),
          frameCount: frames.length,
          eventCount: events.length,
          frames,
          events,
        },
        extra || {}
      );
    },
  };
}

module.exports = { attachTrace };
