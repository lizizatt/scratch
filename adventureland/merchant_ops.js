function vg(n){return(G.items[n]&&G.items[n].g)||0}
function rank_val(it){if(!it||!it.name)return 0;var v=vg(it.name);try{if(typeof item_value==="function")v=Math.max(v,item_value(it)||0)}catch(e){}return v>0?v:vg(it.name)}
function keep_combine(it){var g=it&&G.items[it.name];return!!(g&&g.compound&&(it.level||0)<(COMBINE_MAX||5))}
function sale_price(it){if(!it||!it.name)return 1;var vendor=vg(it.name)||20,v=rank_val(it)||vendor,m=SALE_MULT!=null?SALE_MULT:0.95;return Math.max(1,Math.floor(vendor*m),Math.floor(v*m))}
function lv(it){return(it&&it.level)||0}
function skip_it(it){return!it||is_pot(it)||it.name==="stand0"||it.l}
function cscroll(name,level){var g=G.items[name],grades=(g&&g.grades)||[2],gl=0,i;for(i=0;i<grades.length;i++)if((level||0)>=grades[i])gl=i+1;return gl<=0?"cscroll0":gl===1?"cscroll1":"cscroll2"}
function snap_bank(){var b={},p;if(!character.bank)return;for(p in character.bank)b[p]=character.bank[p]&&character.bank[p].slice?character.bank[p].slice():character.bank[p];character._bank=b}
function bank_obj(){return character.bank||character._bank}
function idx(){
  var out=[],i,pack,bag,s,it,bank;snap_bank();
  for(i=0;i<character.items.length;i++)if((it=character.items[i])&&!skip_it(it))out.push({name:it.name,level:lv(it),qty:it.q||1,where:"bag",loc:i});
  bank=bank_obj();
  if(bank)for(pack in bank){if((""+pack).indexOf("items")!==0)continue;bag=bank[pack];if(!bag)continue;for(i=0;i<bag.length;i++)if((it=bag[i])&&!skip_it(it))out.push({name:it.name,level:lv(it),qty:it.q||1,where:"bank",loc:[pack,i]})}
  for(s=1;s<=16;s++)if((it=character.slots["trade"+s])&&!skip_it(it))out.push({name:it.name,level:lv(it),qty:it.q||1,where:"sale",loc:s});
  for(s in character.slots)if((""+s).indexOf("trade")!==0&&(it=character.slots[s])&&!skip_it(it))out.push({name:it.name,level:lv(it),qty:it.q||1,where:"gear",loc:s});
  return out;
}
function cnt(name,level,where){var n=0,a=idx(),i;for(i=0;i<a.length;i++)if(a[i].name===name&&a[i].level===(level||0)&&(!where||a[i].where===where))n+=a[i].qty;return n}
function hold_item(it){
  if(!it||!it.name)return false;
  var list=HOLD||[],i,maxQ=0,minL=0,pool=[],pack,bag,s,x,bank,key,seen={},n=0;
  for(i=0;i<list.length;i++)if(list[i][0]===it.name){maxQ=list[i][1]||1;minL=list[i][2]||0;break}
  if(!maxQ||lv(it)<minL)return false;
  function add(x,where,loc){if(x&&x.name===it.name&&lv(x)>=minL)pool.push({it:x,lv:lv(x),where:where,loc:loc})}
  for(i=0;i<character.items.length;i++)add(character.items[i],"bag",i);
  bank=bank_obj();
  if(bank)for(pack in bank){if((""+pack).indexOf("items")!==0)continue;bag=bank[pack];if(!bag)continue;for(i=0;i<bag.length;i++)add(bag[i],"bank",pack+":"+i)}
  for(s=1;s<=16;s++)add(character.slots["trade"+s],"sale",s);
  pool.sort(function(a,b){return b.lv-a.lv||String(a.loc).localeCompare(String(b.loc))});
  for(i=0;i<pool.length&&n<maxQ;i++){key=pool[i].where+":"+pool[i].loc;if(seen[key])continue;seen[key]=1;n++;if(pool[i].it===it)return true}
  return false;
}
async function go_npc(to){var r;if(typeof ensure_stand==="function")await ensure_stand(false);else close_stand();if(to==="bank"&&character.map==="bank")return true;return!!(r=await smart_move({to:to}))&&!r.failed}
async function move_ent(e,dest){
  if(e.where===dest)return"have";
  if(e.where==="gear"){if(!character.slots[e.loc])return"fail";try{await unequip(e.loc)}catch(err){return"fail"}if(character.slots[e.loc])return"fail";if(dest==="bag")return"moved";e=find_ent(e.name,e.level,"bag");return e?await move_ent(e,dest):"fail"}
  if(e.where==="sale"){if(!character.slots["trade"+e.loc])return"fail";if(typeof ensure_stand==="function")await ensure_stand(true);else open_stand();try{await unequip("trade"+e.loc)}catch(err){return"fail"}return character.slots["trade"+e.loc]?"fail":"moved"}
  if(e.where==="bank"&&dest==="bag"){if(!(bank_obj()&&bank_obj()[e.loc[0]]&&bank_obj()[e.loc[0]][e.loc[1]]))return"fail";if(!(await go_npc("bank")))return"fail";try{await bank_retrieve(e.loc[0],e.loc[1])}catch(err){return"fail"}snap_bank();return(bank_obj()[e.loc[0]]&&bank_obj()[e.loc[0]][e.loc[1]])?"fail":"moved"}
  if(e.where==="bag"&&dest==="bank"){if(!character.items[e.loc])return"fail";if(!(await go_npc("bank")))return"fail";try{await bank_store(e.loc)}catch(err){return"fail"}snap_bank();return character.items[e.loc]?"fail":"moved"}
  if(e.where==="bag"&&dest==="sale"){var slot=next_trade(),it,q;if(slot<0||!character.items[e.loc])return"fail";it=character.items[e.loc];q=it.q||1;if(typeof ensure_stand==="function")await ensure_stand(true);else open_stand();try{await trade(e.loc,slot,sale_price(it),q)}catch(err){return"fail"}return character.items[e.loc]?"fail":"moved"}
  if(e.where==="bank"&&dest==="sale"){var name=e.name,level=e.level;if((await move_ent(e,"bag"))==="fail")return"fail";e=find_ent(name,level,"bag");if(!e){await strip_gear();e=find_ent(name,level,"bag")}return e?await move_ent(e,"sale"):"fail"}
  return"fail";
}
function find_ent(name,level,where){var a=idx(),i;for(i=0;i<a.length;i++)if(a[i].name===name&&a[i].level===(level||0)&&(!where||a[i].where===where))return a[i];return null}
function bag_three(name,level){var slots=[],i,it;for(i=0;i<character.items.length&&slots.length<3;i++){it=character.items[i];if(it&&it.name===name&&lv(it)===(level||0))slots.push(i)}return slots.length===3?slots:null}
async function wait_q(k){var n;for(n=0;n<200&&character.q&&character.q[k];n++)await sleep(250)}
async function strip_gear(){var s;for(s in character.slots){if(!character.slots[s]||(""+s).indexOf("trade")===0)continue;try{await unequip(s)}catch(e){}}}
function bank_sellable(bad){
  var i,a=idx(),best=null,key,it,val,bestv=-1,bank=bank_obj();
  for(i=0;i<a.length;i++){if(a[i].where!=="bank")continue;key=a[i].loc[0]+":"+a[i].loc[1];if(bad&&bad[key])continue;it=bank&&bank[a[i].loc[0]]&&bank[a[i].loc[0]][a[i].loc[1]];if(!it||skip_it(it)||keep_combine(it)||hold_item(it))continue;val=rank_val(it);if(!best||val>bestv){best=a[i];bestv=val}}
  return best;
}
async function park_bag(){
  var i,it,pass,left,fail=0;
  if(!(await go_npc("bank"))){game_log("park no bank");return false}
  for(pass=0;pass<2;pass++){if(pass)await strip_gear();for(i=0;i<character.items.length;i++){it=character.items[i];if(!it||is_pot(it)||it.name==="stand0"||it.l)continue;try{await bank_store(i)}catch(e){fail=1}}}
  snap_bank();left=0;
  for(i=0;i<character.items.length;i++){it=character.items[i];if(it&&!is_pot(it)&&it.name!=="stand0"&&!it.l)left++}
  if(left){game_log("park left "+left);return false}if(fail)game_log("park store fail");return true;
}
async function ensure_bag(n){n=n||1;if((character.esize||0)>=n)return true;if(!(await park_bag()))return false;if((character.esize||0)>=n)return true;await strip_gear();if(!(await park_bag()))return false;if((character.esize||0)>=n)return true;game_log("ensure_bag fail");return false}
async function restock_sale(){
  var n,src,r,bad={},bagged=0;
  if(typeof ensure_stand==="function")await ensure_stand(false);else close_stand();
  for(n=0;n<32&&bagged<16;n++){if((character.esize||0)<=0)break;src=bank_sellable(bad);if(!src)break;r=await move_ent(src,"bag");if(r==="fail"){bad[src.loc[0]+":"+src.loc[1]]=1;continue}bagged++}
  if(bagged)await list_sale();
}
async function stock_store(){
  if(typeof ensure_stand==="function")await ensure_stand(false);else close_stand();
  if(!(await go_npc("bank"))){game_log("stock no bank");return false}
  if(!(await park_bag()))return false;
  if(!(await empty_sale())){await park_bag();if(!(await empty_sale())){game_log("stock empty fail");return false}}
  if(!sale_clear()){game_log("sale not clear");return false}
  if(!(await park_bag()))return false;
  await restock_sale();
  if(typeof ensure_stand==="function")await ensure_stand(false);else close_stand();
  if((await smart_move({map:"main",x:40,y:-20})||{}).failed){game_log("plaza fail");return false}
  await list_sale();return true;
}
