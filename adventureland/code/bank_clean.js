/**
 * TEMPORARY Puppygirl CODE: one-shot combine + sell junk + gold top-up.
 * Upload over character slot, relink, wait for CLEAN:done, then restore merchant.js.
 * Does not live in the permanent V2 slot set.
 */
var FIGHTERS = ["Jazwyn", "Sarene", "Zarook"];
// Keep in sync with src/constants.js VENDOR_NPC by hand — this file can't
// require() (raw Mainframe CODE upload). Do NOT include goal earrings
// (strearring/vitearring/intearring) or capes; those are never vendor junk.
var SELL = ["dexamulet", "dexearring", "rednose", "wcap", "wshoes", "frogt", "leatherboots", "beewings", "gslime"];
var SELL_LV = [{ name: "shoes", level: 3 }]; // vendor dupes below best — level-gated
var COMBINE = ["orbg", "ringsj", "hpbelt", "hpamulet", "wbook0", "stramulet", "intbelt", "vitring", "armorring"];
var COMBINE_MAX = 5;
var GOLD_FLOAT = 100000;
var GOLD_MERCH_FLOOR = 150000;
var busy = false;
var done = false;

function log(m) {
  try {
    game_log("CLEAN:" + m);
  } catch (e) {}
}
function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}
async function wait_q(k) {
  for (var n = 0; n < 200 && character.q && character.q[k]; n++) await sleep(250);
}
function closeStand() {
  try {
    if (typeof close_stand === "function") close_stand();
    else if (parent && parent.close_merchant) parent.close_merchant();
  } catch (e) {}
}
async function goBank() {
  closeStand();
  var r;
  if (character.map === "bank") return true;
  try {
    r = await smart_move({ map: "bank", x: 0, y: -50 });
    if (r && !r.failed) return true;
  } catch (e0) {}
  try {
    r = await smart_move({ to: "bank" });
    return !!(r && !r.failed);
  } catch (e1) {
    return false;
  }
}
async function leaveBank() {
  if (character.map !== "bank") return true;
  try {
    var r = await smart_move({ map: "main", x: 40, y: -20 });
    return !(r && r.failed);
  } catch (e) {
    return false;
  }
}
function bankObj() {
  return character.bank || null;
}
function isPot(it) {
  return it && (it.name.indexOf("hpot") === 0 || it.name.indexOf("mpot") === 0);
}
function keep(it) {
  if (!it) return true;
  if (isPot(it) || it.name === "stand0" || it.name === "tracker" || it.l) return true;
  if (/^scroll\d$/.test(it.name) || /^cscroll\d$/.test(it.name)) return true;
  return false;
}
function sellOk(it) {
  if (!it || keep(it)) return false;
  if (SELL.indexOf(it.name) >= 0) return true;
  for (var i = 0; i < SELL_LV.length; i++) {
    if (SELL_LV[i].name === it.name && (it.level || 0) === (SELL_LV[i].level || 0)) return true;
  }
  return false;
}
function cscroll(name, level) {
  var g = G.items[name] || {},
    grades = g.grades || [2, 5],
    gl = 0,
    i;
  for (i = 0; i < grades.length; i++) if ((level || 0) >= grades[i]) gl = i + 1;
  return gl <= 0 ? "cscroll0" : gl === 1 ? "cscroll1" : "cscroll2";
}
function cnt(name, level) {
  var n = 0,
    i,
    it,
    bank = bankObj(),
    p,
    bag;
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i];
    if (it && it.name === name && (it.level || 0) === (level || 0)) n++;
  }
  if (bank) {
    for (p in bank) {
      if (p === "gold" || !Array.isArray(bank[p])) continue;
      bag = bank[p];
      for (i = 0; i < bag.length; i++) {
        it = bag[i];
        if (it && it.name === name && (it.level || 0) === (level || 0)) n++;
      }
    }
  }
  return n;
}
function bagThree(name, level) {
  var out = [],
    i,
    it;
  for (i = 0; i < character.items.length && out.length < 3; i++) {
    it = character.items[i];
    if (it && it.name === name && (it.level || 0) === (level || 0)) out.push(i);
  }
  return out.length === 3 ? out : null;
}
function locate(name) {
  for (var i = 0; i < character.items.length; i++) if (character.items[i] && character.items[i].name === name) return i;
  return -1;
}
function findBank(name, level) {
  var bank = bankObj(),
    p,
    bag,
    i,
    it;
  if (!bank) return null;
  for (p in bank) {
    if (p === "gold" || !Array.isArray(bank[p])) continue;
    bag = bank[p];
    for (i = 0; i < bag.length; i++) {
      it = bag[i];
      if (it && it.name === name && (it.level || 0) === (level || 0)) return { pack: p, i: i };
    }
  }
  return null;
}
async function ensureThree(name, level) {
  var need, e;
  while (bagThree(name, level) == null) {
    need = 3;
    for (var i = 0; i < character.items.length; i++) {
      var it = character.items[i];
      if (it && it.name === name && (it.level || 0) === (level || 0)) need--;
    }
    if (need <= 0) break;
    if ((character.esize || 0) < 1) {
      log("no_space_pull");
      return false;
    }
    e = findBank(name, level);
    if (!e) return false;
    if (!(await goBank())) return false;
    try {
      await bank_retrieve(e.pack, e.i);
    } catch (err) {
      return false;
    }
    await sleep(200);
  }
  return !!bagThree(name, level);
}
async function buyCscroll(name) {
  var cost = (G.items[name] && G.items[name].g) || 800;
  if (character.gold - GOLD_MERCH_FLOOR < cost) {
    log("scroll_gold");
    return false;
  }
  closeStand();
  try {
    await smart_move({ map: "main", x: -207, y: -220 });
  } catch (e0) {
    try {
      await smart_move({ to: "upgrade" });
    } catch (e1) {
      return false;
    }
  }
  try {
    await buy(name, 1);
    log("buy " + name);
    return true;
  } catch (e) {
    log("buy_fail " + name);
    return false;
  }
}
async function combineOne() {
  var seen = {},
    cand = [],
    i,
    it,
    name,
    lv,
    key,
    three,
    sc,
    sci,
    r;
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i];
    if (!it || !(G.items[it.name] && G.items[it.name].compound)) continue;
    lv = it.level || 0;
    if (lv >= COMBINE_MAX) continue;
    key = it.name + "@" + lv;
    if (seen[key]) continue;
    seen[key] = 1;
    if (cnt(it.name, lv) >= 3) cand.push({ name: it.name, level: lv });
  }
  var bank = bankObj(),
    p,
    bag;
  if (bank) {
    for (p in bank) {
      if (p === "gold" || !Array.isArray(bank[p])) continue;
      bag = bank[p];
      for (i = 0; i < bag.length; i++) {
        it = bag[i];
        if (!it || !(G.items[it.name] && G.items[it.name].compound)) continue;
        lv = it.level || 0;
        if (lv >= COMBINE_MAX) continue;
        key = it.name + "@" + lv;
        if (seen[key]) continue;
        seen[key] = 1;
        if (cnt(it.name, lv) >= 3) cand.push({ name: it.name, level: lv });
      }
    }
  }
  cand.sort(function (a, b) {
    var pa = COMBINE.indexOf(a.name),
      pb = COMBINE.indexOf(b.name);
    if (pa < 0) pa = 99;
    if (pb < 0) pb = 99;
    return pa !== pb ? pa - pb : b.level - a.level;
  });
  for (i = 0; i < cand.length; i++) {
    name = cand[i].name;
    lv = cand[i].level;
    if (!(await ensureThree(name, lv))) continue;
    three = bagThree(name, lv);
    if (!three) continue;
    sc = cscroll(name, lv);
    sci = locate(sc);
    if (sci < 0) {
      if (!(await buyCscroll(sc))) continue;
      sci = locate(sc);
      if (sci < 0) continue;
      three = bagThree(name, lv);
      if (!three) continue;
    }
    closeStand();
    try {
      await smart_move({ map: "main", x: -207, y: -220 });
    } catch (eM) {
      try {
        await smart_move({ to: "upgrade" });
      } catch (e2) {
        return false;
      }
    }
    three = bagThree(name, lv);
    sci = locate(sc);
    if (!three || sci < 0) continue;
    try {
      await compound(three[0], three[1], three[2], sci);
      await wait_q("compound");
      log("compound " + name + "@" + lv);
      return true;
    } catch (err) {
      log("compound_fail " + name);
      return false;
    }
  }
  return false;
}
async function sellJunkPass() {
  var sold = 0,
    bank = bankObj(),
    p,
    bag,
    i,
    it,
    pulled = 0;
  if (!(await goBank())) {
    log("bank_path_fail");
    return 0;
  }
  // Pull whitelist junk into bag
  if (bank) {
    for (p in bank) {
      if (p === "gold" || !Array.isArray(bank[p])) continue;
      bag = bank[p];
      for (i = 0; i < bag.length && pulled < 20; i++) {
        it = bag[i];
        if (!sellOk(it)) continue;
        if ((character.esize || 0) < 1) break;
        try {
          await bank_retrieve(p, i);
          pulled++;
          await sleep(150);
        } catch (e) {}
      }
    }
  }
  await leaveBank();
  closeStand();
  try {
    await smart_move({ map: "main", x: 56, y: -122 });
  } catch (eV) {}
  for (i = 0; i < character.items.length; i++) {
    it = character.items[i];
    if (!sellOk(it)) continue;
    try {
      await sell(i, it.q == null ? 1 : it.q);
      sold++;
      log("sell " + it.name);
      await sleep(150);
    } catch (eS) {}
  }
  return sold;
}
async function topupFighters() {
  var f,
    i,
    p,
    need,
    n = 0;
  await leaveBank();
  for (i = 0; i < FIGHTERS.length; i++) {
    f = FIGHTERS[i];
    p = get_player(f);
    if (!p || p.rip) {
      log("topup_skip " + f);
      continue;
    }
    need = GOLD_FLOAT - (p.gold || 0);
    if (need <= 0) {
      log("topup_ok " + f);
      continue;
    }
    if (character.gold - GOLD_MERCH_FLOOR < need) {
      log("topup_gold_short " + f);
      continue;
    }
    try {
      if (parent.distance(character, p) > 320 || character.map !== p.map) {
        await smart_move({ map: p.map, x: p.real_x, y: p.real_y });
        p = get_player(f);
      }
      if (!(p && parent.distance(character, p) <= 320)) {
        log("topup_far " + f);
        continue;
      }
      send_gold(f, need);
      log("topup " + f + " +" + need);
      n++;
      await sleep(400);
    } catch (e) {
      log("topup_fail " + f);
    }
  }
  return n;
}
async function runClean() {
  if (done || busy) return;
  busy = true;
  set_message("Clean");
  log("start");
  try {
    closeStand();
    var c,
      n;
    for (c = 0; c < 16; c++) {
      n = await combineOne();
      if (!n) break;
    }
    await sellJunkPass();
    await topupFighters();
    done = true;
    log("done");
    set_message("Clean OK");
  } catch (e) {
    log("err " + ((e && e.reason) || (e && e.message) || e));
    set_message("Clean fail");
  } finally {
    busy = false;
  }
}
setTimeout(function () {
  runClean();
}, 1500);
setInterval(function () {
  if (!done && !busy) runClean();
}, 20000);
