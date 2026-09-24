(async function () {
  const END = Date.now() + 3 * 60 * 1000;
  const DAISY = { map: "main", x: 126, y: -413 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function fmtErr(e) {
    try {
      if (!e) return "null";
      if (typeof e === "string") return e;
      const msg = e.message || e.reason || e.code;
      const stack = e.stack;
      const j = JSON.stringify(e);
      return msg ? msg + (stack ? "\n" + stack : "") + (j && j !== "{}" ? "\n" + j : "") : j;
    } catch (x) {
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

  const before = tokenCount();
  game_log("LIVE_MH_DBG_BEGIN before=" + before);

  function huntSnap() {
    return character && character.s && character.s.monsterhunt ? character.s.monsterhunt : null;
  }

  let cycles = 0;
  while (Date.now() < END) {
    try {
      game_log("LIVE_MH_DBG_cycle_begin " + cycles);

      const sm1 = await smart_move(DAISY);
      game_log("LIVE_MH_DBG_move_daisy1 " + (sm1 && sm1.failed ? "FAILED " + sm1.reason : "OK"));

      const acc = await interact("monsterhunt");
      game_log("LIVE_MH_DBG_interact_accept " + (acc && (acc.failed ? "FAILED " + acc.reason : "OK")));

      let h = null;
      for (let t0 = Date.now(); Date.now() - t0 < 60000; ) {
        h = huntSnap();
        if (h && h.id && h.c != null) break;
        await sleep(2000);
      }

      if (!h || !h.id) {
        game_log("LIVE_MH_DBG_accept_fail snap=" + JSON.stringify(h));
        await sleep(5000);
        continue;
      }
      game_log("LIVE_MH_DBG_hunt_started snap=" + JSON.stringify({ id: h.id, c: h.c, sn: h.sn }));

      try {
        send_cm("Jazwyn", { hunt: "" + h.id });
      } catch (e) {
        game_log("LIVE_MH_DBG_send_cm_fail " + fmtErr(e));
      }

      let lastLog = 0;
      for (;;) {
        if (Date.now() >= END) break;
        h = huntSnap();
        if (h && h.c === 0) break;
        if (Date.now() - lastLog > 20000) {
          lastLog = Date.now();
          game_log("LIVE_MH_DBG_wait c=" + (h && h.c) + " id=" + (h && h.id));
        }
        await sleep(3000);
      }

      h = huntSnap();
      if (!h || h.c !== 0) {
        game_log("LIVE_MH_DBG_abort_wait_end snap=" + JSON.stringify(h));
        break;
      }

      const sm2 = await smart_move(DAISY);
      game_log("LIVE_MH_DBG_move_daisy2 " + (sm2 && sm2.failed ? "FAILED " + sm2.reason : "OK"));

      const done = await interact("monsterhunt");
      game_log("LIVE_MH_DBG_turnin " + (done && done.failed ? "FAILED " + (done.reason || "") : "OK"));

      cycles++;
      await sleep(8000);
    } catch (e) {
      game_log("LIVE_MH_DBG_cycle_err " + fmtErr(e));
      await sleep(8000);
    }
  }

  const after = tokenCount();
  game_log("LIVE_MH_DBG_DONE cycles=" + cycles + " tokenGain=" + (after - before) + " after=" + after);
})().catch((e) => {
  try {
    game_log("LIVE_MH_DBG_FATAL " + (e && e.message ? e.message : e));
  } catch (_) {}
});

