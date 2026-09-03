var ponty_miss = {};
async function list_ponty() {
  var list, items;
  try {
    list = await get_secondhands(1500);
    items = (list && list.items) || list;
    if (items && items.length != null) return items;
  } catch (e) {}
  return await new Promise(function (resolve) {
    var done = false, sock = parent.socket, t;
    function finish(data) {
      if (done) return;
      done = true;
      clearTimeout(t);
      try { if (sock.off) sock.off("secondhands", on); else sock.removeListener("secondhands", on); } catch (err) {}
      resolve(Array.isArray(data) ? data : []);
    }
    function on(data) { finish(data); }
    t = setTimeout(function () { finish([]); }, 2500);
    try { sock.on("secondhands", on); sock.emit("secondhands"); } catch (err) { finish([]); }
  });
}
async function buy_ponty(rid) {
  try { await buy_secondhand(rid, 2000); return "bought"; } catch (e) {}
  var gold0 = character.gold, es0 = character.esize, n;
  try { parent.socket.emit("sbuy", { rid: rid }); } catch (e) { return "fail"; }
  for (n = 0; n < 40; n++) {
    await sleep(50);
    if (character.gold < gold0 || character.esize < es0) return "bought";
  }
  return "fail";
}
async function buy_leaf(name, level) {
  var spend = character.gold - (GOLD_FLOAT || 0), items, it, i, key = name + "@" + (level || 0);
  if (spend <= 0) return "fail";
  if ((name.indexOf("cscroll") === 0 || name.indexOf("scroll") === 0) && spend >= vg(name)) {
    try { if (!(await go_npc("upgrade"))) return "fail"; await buy_with_gold(name, 1); return "bought"; } catch (e) {}
  }
  if (ponty_miss[key] && Date.now() < ponty_miss[key]) return "fail";
  if (!(await go_npc("secondhands"))) return "fail";
  items = await list_ponty();
  for (i = 0; i < 16; i++) {
    it = pick_ponty(items, name, level);
    if (!it || !it.rid || it.price > spend) { ponty_miss[key] = Date.now() + 30000; return "fail"; }
    if ((await buy_ponty(it.rid)) === "bought") { delete ponty_miss[key]; return "bought"; }
    items = items.filter(function (x) { return x && String(x.rid) !== String(it.rid); });
  }
  return "fail";
}
