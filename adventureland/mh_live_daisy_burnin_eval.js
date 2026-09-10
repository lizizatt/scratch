(async function () {
  const END = Date.now() + 10 * 60 * 1000;
  const DAISY = { map: "main", x: 126, y: -413 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  let cycles = 0;
  game_log("LIVE_MH_BEGIN before=" + before);

  while (Date.now() < END) {
    try {
      game_log("LIVE_MH_cycle_begin " + cycles);
      await smart_move(DAISY);
      await interact("monsterhunt"); // accept

      // Wait for hunt condition to appear
      let h = null;
      for (let t0 = Date.now(); Date.now() - t0 < 120000; ) {
        h = character && character.s && character.s.monsterhunt;
        if (h && h.id && h.c != null) break;
        await sleep(2000);
      }
      if (!h || !h.id) {
        game_log("LIVE_MH_accept_fail");
        await sleep(5000);
        continue;
      }

      game_log("LIVE_MH_hunt id=" + h.id + " c=" + h.c + " sn=" + h.sn);

      // Set fighter intent to hunt this pack type
      try {
        send_cm("Jazwyn", { hunt: "" + h.id });
      } catch (e) {
        game_log("LIVE_MH_send_cm_fail");
      }

      // Wait until c===0
      for (;;) {
        if (Date.now() >= END) break;
        h = character && character.s && character.s.monsterhunt;
        if (h && h.c === 0) break;
        await sleep(3000);
      }
      h = character && character.s && character.s.monsterhunt;
      if (!h || h.c !== 0) {
        game_log("LIVE_MH_abort_before_end");
        break;
      }

      // Turn in at Daisy
      await smart_move(DAISY);
      let done = await interact("monsterhunt");
      game_log("LIVE_MH_turnin " + (done && done.reason ? done.reason : "ok"));
      cycles++;
      await sleep(10000);
    } catch (e) {
      game_log("LIVE_MH_cycle_err " + (e && e.message ? e.message : e));
      await sleep(8000);
    }
  }

  const after = tokenCount();
  game_log("LIVE_MH_DONE cycles=" + cycles + " tokenGain=" + (after - before) + " after=" + after);
})().catch((e) => {
  try {
    game_log("LIVE_MH_FATAL " + (e && e.message ? e.message : e));
  } catch (_) {}
});

