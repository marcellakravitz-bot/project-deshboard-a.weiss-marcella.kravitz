// ---------------------------------------------------------------------------
// The subcontractor's app (06.11.26). His own trade only, and view only.
// Home: the project and "קבלן <trade>", this week's schedule, then
//   יומן עדכונים · Submittal · SD · ריג'קטים (lists made for his trade)
//   · בדיקות מכון התקנים (only when checks were set for him on the dashboard)
// ---------------------------------------------------------------------------
(function(){
var E=AW.esc, S=AW.state;
var IC={
  finishes:"M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4",
  log:"M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12h7M8 16h5",
  submittal:"M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  sd:"M3 21l6-6M14 4l6 6M4 20l3-9 9-3 1 1-3 9-9 3z",
  rj:"M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  standards:"M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  weekly:"M3 6h18M3 12h18M3 18h18M8 3v18M16 3v18"
};
var lists={ submittal:{filter:{}, simple:true}, sd:{filter:{}, simple:true} };
var rjN=null, weekShown=null;

function longBtn(k, title, extra){
  return '<button class="longBtn" data-k="'+k+'">'+'<span class="ico">'+AW.icon(IC[k])+'</span><span class="t">'+E(title)+'</span>'+(AW.isNew(k)?'<span class="newStar">★ עדכון חדש</span>':'')+(extra?'<span class="n">'+E(extra)+'</span>':'')+'</button>';
}
var wkAhead=0;   // 0 — this week, 1 — the next one; nothing further
function home(){
  var b=S.board, app=AW.el();
  var wk=AW.shiftWeek(AW.sundayOf(new Date()), wkAhead), days=AW.weekDays(wk), cells=(b.weekly||{})[wk]||[];
  var star=AW.isNew("weekly")?'<span class="newStar">★ עדכון חדש</span>':'';
  var h=((S.projects||[]).length>1||AW.PREVIEW?'<button class="backArrow" id="toProj" aria-label="פרויקטים">'+AW.icon("M15 6l-6 6 6 6")+'</button>':'')+
    AW.projHead("קבלן "+AW.tradeHe(b.trade))+
    '<div class="wkBox"><div class="wh"><b>לו״ז שבועי '+star+'</b><div class="chips">'+
      '<button class="chip'+(wkAhead===0?" on":"")+'" data-w="0">השבוע</button>'+
      '<button class="chip'+(wkAhead===1?" on":"")+'" data-w="1">שבוע הבא</button></div></div>'+
    AW.timetable(wk, function(i){ var t=String(cells[i]||"").trim(); return t?'<span class="clamp">'+E(t)+'</span>':""; })+'</div>'+
    longBtn("log","יומן עדכונים")+longBtn("submittal","Submittal")+longBtn("sd","SD")+
    (rjN?longBtn("rj","ריג'קטים", String(rjN)):"")+
    longBtn("standards","בדיקות ומכון התקנים")+longBtn("finishes","רשימת חומרי גמר");
  app.innerHTML=h;
  var tp=document.getElementById("toProj"); if(tp) tp.onclick=AW.toEntry;
  Array.prototype.forEach.call(app.querySelectorAll("[data-w]"), function(el){
    el.onclick=function(){ wkAhead=Number(el.getAttribute("data-w")); AW.render(true); };
  });
  // A day opens in full, large.
  Array.prototype.forEach.call(app.querySelectorAll(".wkBox tr[data-day]"), function(tr){
    tr.onclick=function(){
      var i=Number(tr.getAttribute("data-day")), d=days[i], t=String(cells[i]||"").trim();
      AW.markSeen("weekly");
      AW.pop(E(d.name)+' · <span class="num">'+E(AW.fmt(d.iso))+'</span>', t?'<div class="dayBig">'+E(t)+'</div>':'<p class="lead">לא נרשמו עבודות ליום הזה.</p>');
    };
  });
  Array.prototype.forEach.call(app.querySelectorAll(".longBtn[data-k]"), function(el){
    el.onclick=function(){
      var k=el.getAttribute("data-k"); AW.markSeen(k);
      if(k==="rj"){ AW.rejects.reset(); AW.go({v:"rj"}); return; }
      AW.go({v:k});
    };
  });
}
// Every week that has work written, newest first; read only.
function weekly(){
  var w=S.board.weekly||{};
  if(!weekShown) weekShown=AW.sundayOf(new Date());
  var days=AW.weekDays(weekShown), cells=w[weekShown]||[];
  AW.el().innerHTML=AW.head("לו״ז שבועי - קבלן "+E(AW.tradeHe(S.board.trade)))+
    '<div class="wkNav"><button id="wkPrev">‹</button><strong class="num">'+E(AW.fmt(weekShown))+' – '+E(AW.fmt(days[5].iso))+'</strong><button id="wkNext">›</button></div>'+
    '<div class="rec" style="padding:8px">'+AW.timetable(weekShown, function(i){ var t=String(cells[i]||"").trim(); return t?E(t):""; })+'</div>';
  AW.wireBack();
  document.getElementById("wkPrev").onclick=function(){ weekShown=AW.shiftWeek(weekShown,-1); AW.render(true); };
  document.getElementById("wkNext").onclick=function(){ weekShown=AW.shiftWeek(weekShown,1); AW.render(true); };
}
function log(){
  var list=S.board.log||[];
  AW.el().innerHTML=AW.head("יומן עדכונים - קבלן "+E(AW.tradeHe(S.board.trade)))+AW.logTable(list);
  AW.wireBack(); AW.wireLogTable(list);
}
function itemScreen(kind){
  var o=lists[kind];
  o.items = kind==="sd" ? (S.board.sd||[]) : (S.board.submittals||[]);
  o.kind=kind;
  AW.el().innerHTML=AW.head(kind==="sd"?"SD":"Submittal")+AW.itemList(o);
  AW.wireBack();
  AW.wireItemList(o, function(keep){ AW.render(!!keep); });
}
function standards(){
  AW.el().innerHTML=AW.head("בדיקות ומכון התקנים")+AW.standardsSimple(S.board.standards);
  AW.wireBack();
}
var fin={q:""};
function finishes(){
  fin.items=S.board.finishes||[];
  AW.el().innerHTML=AW.head("רשימת חומרי גמר")+AW.finishes(fin);
  AW.wireBack(); AW.wireFinishes(fin, function(){ AW.render(true); });
}
function draw(v){
  if(!S.board) return;
  switch(v.v){
    case "log": return log();
    case "submittal": return itemScreen("submittal");
    case "sd": return itemScreen("sd");
    case "standards": return standards();
    case "finishes": return finishes();
    case "rj": return AW.rejects.draw(v);
    default: return home();
  }
}
AW.boot({ render:draw, ready:function(){
  // The rejects button appears once there is a list made for his trade.
  AW.rejects.count(function(n){ rjN=n; if(AW.view().v==="home") AW.render(true); });
}});
})();
