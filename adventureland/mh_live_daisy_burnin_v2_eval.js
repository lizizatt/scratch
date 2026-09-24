(async function () {
  const END = Date.now() + 10 * 60 * 1000;
  const DAISY = { map: "main", x: 126, y: -413 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmtErr(e) {
    try {
      if (!e) return "null";
      if (typeof e === "string") return e;
      return e && (e.message || e.reason) ? (e.message || e.reason) : JSON.stringify(e);
    } catch (_) {
      return String(e);
    }
  }

  function tokenCount() {
    try {
      const it = (character && character.items) ? character.items : [];
      let n = 0;
      for (const x of it) {
        if (x && x.name === "monstertoken") n += x.q == null ? 1 : x.q;
      }
      return n;
    } catch (e) {
      return 0;
    }
  }

  function huntSnap() {
    return character && character.s && character.s.monsterhunt ? character.s.monsterhunt : null;
  }

  const before = tokenCount();
  let cycles = 0;
  game_log("LIVE_MH_V2_BEGIN before=" + before);

  while (Date.now() < END) {
    try {
      // If hunt is already active, proceed; otherwise accept at Daisy.
      let h = huntSnap();
      if (!h || !h.id || h.c == null) {
        game_log("LIVE_MH_V2_accept_needed");
        await smart_move(DAISY);
        try {
          await interact("monsterhunt");
        } catch (e) {
          game_log("LIVE_MH_V2_accept_err " + fmtErr(e));
        }
      }

      // Wait for hunt condition
      for (let t0 = Date.now(); Date.now() - t0 < 120000; ) {
        h = huntSnap();
        if (h && h.id && h.c != null) break;
        await sleep(2000);
      }
      if (!h || !h.id) {
        game_log("LIVE_MH_V2_accept_fail snap=" + JSON.stringify(h));
        await sleep(5000);
        continue;
      }

      game_log("LIVE_MH_V2_hunt id=" + h.id + " c=" + h.c + " sn=" + h.sn);

      // Ensure fighter intent matches the current hunt.id
      try {
        send_cm("Jazwyn", { hunt: "" + h.id });
      } catch (e) {
        game_log("LIVE_MH_V2_send_cm_fail " + fmtErr(e));
      }

      // Wait until c===0 (hunt kills complete)
      let lastLog = 0;
      for (;;) {
        if (Date.now() >= END) break;
        h = huntSnap();
        if (h && h.c === 0) break;
        if (Date.now() - lastLog > 20000) {
          lastLog = Date.now();
          game_log("LIVE_MH_V2_wait c=" + (h && h.c) + " id=" + (h && h.id));
        }
        await sleep(3000);
      }
      h = huntSnap();
      if (!h || h.c !== 0) {
        game_log("LIVE_MH_V2_abort_before_end snap=" + JSON.stringify(h));
        break;
      }

      // Turn-in at Daisy
      await smart_move(DAISY);
      let done = null;
      try {
        done = await interact("monsterhunt");
      } catch (e) {
        game_log("LIVE_MH_V2_turnin_err " + fmtErr(e));
      }
      game_log("LIVE_MH_V2_turnin " + (done && done.reason ? done.reason : "ok"));
      cycles++;
      await sleep(8000);
    } catch (e) {
      game_log("LIVE_MH_V2_cycle_err " + fmtErr(e));
      await sleep(8000);
    }
  }

  const after = tokenCount();
  game_log("LIVE_MH_V2_DONE cycles=" + cycles + " tokenGain=" + (after - before) + " after=" + after);
})().catch((e) => {
  try {
    game_log("LIVE_MH_V2_FATAL " + (e && (e.message || e.reason) ? e.message || e.reason : e));
  } catch (_) {}
});

