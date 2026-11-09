// ---------------------------------------------------------------------------
// The project manager's app (06.11.26).
// Home: the project, this week's schedule split by trade, then
//   ניהול משימות · יומן עדכונים · ריג'קטים · Submittal · SD · בדיקות מכון התקנים
// He sees every trade; he writes the log and the weekly schedule, opens and
// updates tasks and rejects. Everything else is read.
// ---------------------------------------------------------------------------
(function(){
var E=AW.esc, S=AW.state;
var IC={
  finishes:"M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4",
  tasks:"M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  log:"M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12h7M8 16h5",
  rj:"M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  submittal:"M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  sd:"M3 21l6-6M14 4l6 6M4 20l3-9 9-3 1 1-3 9-9 3z",
  standards:"M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  weekly:"M3 6h18M3 12h18M3 18h18M8 3v18M16 3v18",
  schedule:"M3 5h8M3 10h12M3 15h6M3 20h10M15 3v4M19 3v4M14 5h7",
  trade:"M2 20h20M5 20V9l7-5 7 5v11M9 20v-6h6v6"
};
var lists={ submittal:{filter:{}}, sd:{filter:{}} };
var logDraft=null, weekBuf=null, weekShown=null, weekFloor=null;

function longBtn(k, title, extra, id){
  return '<button class="longBtn"'+(id?' id="'+id+'"':' data-k="'+k+'"')+'>'+'<span class="ico">'+AW.icon(IC[k]||IC.log)+'</span><span class="t">'+E(title)+'</span>'+(AW.isNew(k)?'<span class="newStar">★ עדכון חדש</span>':'')+
    (extra?'<span class="n">'+E(extra)+'</span>':'')+'</button>';
}
// 09.11.26 — the floors in the project's order, then by number.
function floorSort(list){
  var order=(S.board.myFloors||[]).map(String);
  return list.slice().sort(function(a,b){
    var ia=order.indexOf(a), ib=order.indexOf(b);
    if(ia>=0&&ib>=0) return ia-ib;
    if(ia>=0||ib>=0) return ia>=0?-1:1;
    var na=parseFloat(a), nb=parseFloat(b);
    return (isNaN(na)||isNaN(nb)) ? a.localeCompare(b,"he") : na-nb;
  });
}
// One day of the week, every trade that has work written for it. A trade
// written per floor: its box split, קומה 7 – … then under a fine line קומה 8 – …
function dayCell(wk, i){
  var w=(S.board.weekly||{}), raw=S.board.weeklyRaw;
  return AW.TRADES.map(function(t){
    var parts=raw&&raw[t.k];
    if(!parts){
      var txt=String((((w[t.k]||{})[wk])||[])[i]||"").trim();
      return txt ? '<span class="tr"><b>'+E(t.t)+':</b> '+E(txt)+'</span>' : "";
    }
    var gen=String(((parts[""]||{})[wk]||[])[i]||"").trim();
    var fl=floorSort(Object.keys(parts).filter(function(f){ return f!==""; }))
      .map(function(f){ return {f:f, t:String(((parts[f]||{})[wk]||[])[i]||"").trim()}; })
      .filter(function(x){ return x.t; });
    if(!gen&&!fl.length) return "";
    return '<span class="tr"><b>'+E(t.t)+':</b>'+(gen?' '+E(gen):'')+
      fl.map(function(x,n){ return '<span class="trFl'+(!gen&&!n?' first':'')+'"><i>קומה <span class="num">'+E(x.f)+'</span></i> – '+E(x.t)+'</span>'; }).join("")+'</span>';
  }).join("");
}

function home(){
  var app=AW.el(), b=S.board;
  var tn=null;
  var h=((S.projects||[]).length>1||AW.PREVIEW?'<button class="backArrow" id="toProj" aria-label="פרויקטים">'+AW.icon("M15 6l-6 6 6 6")+'</button>':'')+
    AW.projHead("מנהל פרויקט");
  var wk=AW.sundayOf(new Date()), days=AW.weekDays(wk);
  h+='<button class="wkCard" data-k="weekly">'+
    '<div class="wh"><b>לו״ז שבועי'+(AW.isNew("weekly")?'<span class="newStar">★ עדכון חדש</span>':'')+'</b><span class="num">'+E(AW.fmt(wk))+' – '+E(AW.fmt(days[5].iso))+'</span></div>'+
    AW.timetable(wk, function(i){ return dayCell(wk,i); })+'</button>';
  // 07.11.26 — always there; without a schedule it says so when opened.
  h+=longBtn("schedule","לו״ז פרויקט");
  h+=longBtn("tasks","ניהול משימות")+longBtn("log","יומן עדכונים")+longBtn("rj","ריג'קטים")+
     longBtn("submittal","Submittal")+longBtn("sd","SD")+longBtn("standards","בדיקות ומכון התקנים")+longBtn("finishes","רשימת חומרי גמר");
  app.innerHTML=h;
  var tp=document.getElementById("toProj"); if(tp) tp.onclick=AW.toEntry;
  Array.prototype.forEach.call(app.querySelectorAll("[data-k]"), function(el){
    el.onclick=function(){
      var k=el.getAttribute("data-k");
      AW.markSeen(k);
      if(k==="rj"){ AW.rejects.reset(); AW.go({v:"rj"}); return; }
      if(k==="tasks"){ PMTasks.reset(); AW.go({v:"tasks"}); return; }
      AW.go({v:k});
    };
  });
  // 07.11.26 — a day pressed in the week opens that day alone.
  Array.prototype.forEach.call(app.querySelectorAll(".wkCard tr[data-day]"), function(tr){
    tr.onclick=function(e){
      e.stopPropagation(); AW.markSeen("weekly");
      weekShown=AW.sundayOf(new Date());
      AW.go({v:"weekly", day:Number(tr.getAttribute("data-day"))});
    };
  });
}

// ------------------------------------------------------------------ weekly
// The week for every trade; a trade's own week is edited one day at a time,
// so two people on different days never write over each other.
// 07.11.26 — one day: the day pressed, in the same box, and under it the
// contractors' editing as on the week. The arrows go a day at a time.
function weekDay(day){
  var app=AW.el();
  if(!weekShown) weekShown=AW.sundayOf(new Date());
  var d=AW.weekDays(weekShown)[day], c=dayCell(weekShown, day);
  app.innerHTML=AW.head("לו״ז שבועי")+
    '<div class="wkNav"><button id="wkPrev">‹</button><strong>יום '+E(d.name)+' <span class="num">'+E(AW.fmt(d.iso))+'</span></strong><button id="wkNext">›</button></div>'+
    '<div class="wkAllBar"><button class="chip" id="wkAll">כל השבוע</button></div>'+
    '<div class="rec" style="padding:8px"><table class="tt one"><tbody><tr class="'+(d.iso===AW.todayIso()?"today":"")+'"><th>'+E(d.name)+'<span class="num">'+E(AW.fmt(d.iso).slice(0,5))+'</span></th>'+
      '<td class="'+(c?"":"none")+'">'+(c||"—")+'</td></tr></tbody></table></div>'+
    tradeEditHtml();
  AW.wireBack();
  var step=function(n){
    var i=day+n;
    if(i<0){ weekShown=AW.shiftWeek(weekShown,-1); i=5; }
    else if(i>5){ weekShown=AW.shiftWeek(weekShown,1); i=0; }
    AW.replace({v:"weekly", day:i});
  };
  document.getElementById("wkPrev").onclick=function(){ step(-1); };
  document.getElementById("wkNext").onclick=function(){ step(1); };
  document.getElementById("wkAll").onclick=function(){ AW.replace({v:"weekly"}); };
  wireTradeEdit(app);
}
function tradeEditHtml(){
  return '<div class="lbl">עריכת הלו״ז לקבלן</div><div class="trGrid">'+
    AW.TRADES.map(function(t){ return '<button class="trSq" data-tr="'+t.k+'">'+AW.icon(IC.trade)+'<span>'+E(t.t)+'</span></button>'; }).join("")+'</div>';
}
function wireTradeEdit(app){
  Array.prototype.forEach.call(app.querySelectorAll("[data-tr]"), function(b){
    b.onclick=function(){ weekBuf=null; weekFloor=null; AW.go({v:"weekEdit", trade:b.getAttribute("data-tr")}); };
  });
}
function weekly(day){
  if(day!=null && day>=0 && day<=5) return weekDay(day);
  var app=AW.el(), w=S.board.weekly||{};
  if(!weekShown) weekShown=AW.sundayOf(new Date());
  var days=AW.weekDays(weekShown);
  app.innerHTML=AW.head("לו״ז שבועי")+
    '<div class="wkNav"><button id="wkPrev">‹</button><strong class="num">'+E(AW.fmt(weekShown))+' – '+E(AW.fmt(days[5].iso))+'</strong><button id="wkNext">›</button></div>'+
    '<div class="rec wkPick" style="padding:8px">'+AW.timetable(weekShown, function(i){ return dayCell(weekShown,i); })+'</div>'+
    '<div class="lbl">עריכת הלו״ז לקבלן</div><div class="trGrid">'+
    AW.TRADES.map(function(t){ return '<button class="trSq" data-tr="'+t.k+'">'+AW.icon(IC.trade)+'<span>'+E(t.t)+'</span></button>'; }).join("")+'</div>';
  AW.wireBack();
  document.getElementById("wkPrev").onclick=function(){ weekShown=AW.shiftWeek(weekShown,-1); AW.render(true); };
  document.getElementById("wkNext").onclick=function(){ weekShown=AW.shiftWeek(weekShown,1); AW.render(true); };
  wireTradeEdit(app);
  // A day of the week pressed here opens that day alone too.
  Array.prototype.forEach.call(app.querySelectorAll(".wkPick tr[data-day]"), function(tr){
    tr.onclick=function(){ AW.go({v:"weekly", day:Number(tr.getAttribute("data-day"))}); };
  });
}
function weekEdit(trade){
  var app=AW.el();
  if(!weekShown) weekShown=AW.sundayOf(new Date());
  // 09.11.26 — the floor written for: chosen above the days. A floor chosen
  // for the app: that floor. Otherwise כל הקומות and the floors of the
  // trade's contractors (or the project's, if none has floors of his own).
  var raw=(S.board.weeklyRaw||{})[trade];
  var appFl=S.board.floor||"";
  var opts=[];
  if(raw){
    if(appFl) opts=[appFl];
    else {
      var tf=((S.board.tradeFloors||{})[trade]||[]).map(String);
      var base=tf.length?tf:(S.board.myFloors||[]).map(String);
      Object.keys(raw).forEach(function(f){ if(f&&base.indexOf(f)<0) base.push(f); });
      opts=[""].concat(floorSort(base));
    }
    if(weekFloor===null||opts.indexOf(weekFloor)<0){
      var tf2=((S.board.tradeFloors||{})[trade]||[]).map(String);
      weekFloor=appFl||(tf2.length&&opts.indexOf(floorSort(tf2)[0])>=0?floorSort(tf2)[0]:"");
    }
  }
  var stored=raw ? ((raw[weekFloor||""]||{})[weekShown]||[]) : ((((S.board.weeklyEdit||S.board.weekly||{})[trade]||{})[weekShown])||[]);
  var days=AW.weekDays(weekShown);
  var val=function(i){ return weekBuf&&weekBuf[i]!=null ? weekBuf[i] : (stored[i]||""); };
  var dirty=!!weekBuf&&Object.keys(weekBuf).some(function(i){ return (weekBuf[i]||"")!==(stored[i]||""); });
  app.innerHTML=AW.head("לו״ז שבועי - קבלן "+E(AW.tradeHe(trade))+(raw?"":(AW.state.floor&&AW.state.floor!=="*"?" · קומה "+E(AW.state.floor):"")))+
    (raw&&opts.length>1 ? '<div class="lbl">קומה</div><div class="chips wkFl">'+opts.map(function(f){
      return '<button class="chip'+(f===weekFloor?' on':'')+'" data-fl="'+E(f)+'">'+(f?'קומה <span class="num">'+E(f)+'</span>':'כל הקומות')+'</button>';
    }).join("")+'</div>' : (raw&&weekFloor ? '<div class="lbl">קומה <span class="num">'+E(weekFloor)+'</span></div>' : ''))+
    '<div class="wkNav"><button id="wkPrev">‹</button><strong class="num">'+E(AW.fmt(weekShown))+' – '+E(AW.fmt(days[5].iso))+'</strong><button id="wkNext">›</button></div>'+
    days.map(function(d,i){
      return '<div class="wkDay"><div class="wkHead">'+d.name+'<span class="num">'+E(AW.fmt(d.iso))+'</span></div>'+
        '<textarea data-d="'+i+'" placeholder="עבודות נדרשות">'+E(val(i))+'</textarea></div>';
    }).join("")+
    '<div class="writeBar"><button id="wkSave"'+(dirty?"":" disabled")+'>'+(dirty?"שמירה":"נשמר")+'</button></div>';
  AW.wireBack();
  Array.prototype.forEach.call(app.querySelectorAll(".wkFl [data-fl]"), function(c){
    c.onclick=function(){
      var f=c.getAttribute("data-fl");
      if(f===weekFloor) return;
      if(dirty||(weekBuf&&Object.keys(weekBuf).some(function(i){ return (weekBuf[i]||"")!==(stored[i]||""); }))){
        if(!confirm("השינויים בקומה הזו לא נשמרו. לעבור בכל זאת?")) return;
      }
      weekFloor=f; weekBuf=null; AW.render(true);
    };
  });
  Array.prototype.forEach.call(app.querySelectorAll(".wkDay textarea"), function(t){
    t.oninput=function(){ weekBuf=weekBuf||{}; weekBuf[t.getAttribute("data-d")]=t.value;
      var sv=document.getElementById("wkSave"); sv.disabled=false; sv.textContent="שמירה"; };
  });
  document.getElementById("wkPrev").onclick=function(){ weekShown=AW.shiftWeek(weekShown,-1); weekBuf=null; AW.render(true); };
  document.getElementById("wkNext").onclick=function(){ weekShown=AW.shiftWeek(weekShown,1); weekBuf=null; AW.render(true); };
  var ws=document.getElementById("wkSave");
  ws.onclick=function(){
    var changed=Object.keys(weekBuf||{}).filter(function(i){ return (weekBuf[i]||"")!==(stored[i]||""); });
    if(!changed.length) return;
    ws.disabled=true; ws.textContent="שומר…";
    var chain=Promise.resolve(), failed=false;
    changed.forEach(function(i){
      chain=chain.then(function(){
        var body={action:"set-week", projectId:S.project, trade:trade, weekStart:weekShown, day:Number(i), text:weekBuf[i]||""};
        if(raw) body.floor=weekFloor||"";
        return AW.call(body)
          .then(function(r){ if(!r.ok) failed=true; });
      });
    });
    chain.then(function(){
      if(failed){ ws.disabled=false; ws.textContent="שמירה"; alert("חלק מהשמירה נכשל."); return; }
      weekBuf=null; AW.loadBoard(true).then(function(){ AW.render(true); });
    }).catch(function(){ ws.disabled=false; ws.textContent="שמירה"; alert("אין חיבור."); });
  };
}

// --------------------------------------------------------------------- log
function logTrades(){
  var app=AW.el(), logs=S.board.logs||{};
  app.innerHTML=AW.head("יומן עדכונים")+AW.TRADES.map(function(t){
    var n=(logs[t.k]||[]).length;
    return '<button class="longBtn" data-tr="'+t.k+'"><span class="ico">'+AW.icon(IC.trade)+'</span><span class="t">קבלן '+E(t.t)+'</span>'+
      (n?'<span class="n">'+n+'</span>':'')+'</button>';
  }).join("");
  AW.wireBack();
  Array.prototype.forEach.call(app.querySelectorAll("[data-tr]"), function(b){
    b.onclick=function(){ logDraft=null; AW.go({v:"logTrade", trade:b.getAttribute("data-tr")}); };
  });
}
function logTrade(trade){
  var app=AW.el(), list=(S.board.logs||{})[trade]||[];
  var form=!logDraft ? '<div class="writeBar"><button id="newLog">+ עדכון חדש</button></div>'
    : '<div class="form"><input id="lsub" placeholder="נושא" value="'+E(logDraft.subject)+'">'+
      '<textarea id="ltxt" placeholder="תיאור">'+E(logDraft.body)+'</textarea>'+
      '<div class="shots">'+logDraft.photos.map(function(p){ return '<img src="'+p.data+'" alt="">'; }).join("")+
      '<label>📷<input id="lcam" type="file" accept="image/*" capture="environment" style="display:none"></label>'+
      '<label>+<input id="lgal" type="file" accept="image/*" multiple style="display:none"></label></div>'+
      '<div class="row"><button id="lsave">שמירה</button><button id="lcancel" class="ghost">ביטול</button></div></div>';
  app.innerHTML=AW.head("יומן עדכונים - קבלן "+E(AW.tradeHe(trade)))+form+AW.logTable(list);
  AW.wireBack(); AW.wireLogTable(list);
  var keep=function(){ logDraft.subject=(document.getElementById("lsub")||{}).value||""; logDraft.body=(document.getElementById("ltxt")||{}).value||""; };
  var nl=document.getElementById("newLog"); if(nl) nl.onclick=function(){ logDraft={subject:"",body:"",photos:[]}; AW.render(true); };
  var lc=document.getElementById("lcancel"); if(lc) lc.onclick=function(){ logDraft=null; AW.render(true); };
  var add=function(fl){
    keep();
    Promise.all(Array.prototype.slice.call(fl||[]).map(AW.shrink)).then(function(got){
      got.forEach(function(ph){ if(ph) logDraft.photos.push(ph); }); AW.render(true);
    });
  };
  var cam=document.getElementById("lcam"); if(cam) cam.onchange=function(){ add(cam.files); };
  var gal=document.getElementById("lgal"); if(gal) gal.onchange=function(){ add(gal.files); };
  var ls=document.getElementById("lsave");
  if(ls) ls.onclick=function(){
    keep();
    if(!logDraft.subject.trim()){ alert("צריך נושא."); return; }
    ls.disabled=true; ls.textContent="שומר…";
    AW.call({action:"add-log", projectId:S.project, trade:trade, subject:logDraft.subject, text:logDraft.body, photos:logDraft.photos})
      .then(function(r){
        if(!r.ok){ ls.disabled=false; ls.textContent="שמירה"; alert("השמירה נכשלה."); return; }
        logDraft=null; AW.loadBoard(true).then(function(){ AW.render(true); });
      }).catch(function(){ ls.disabled=false; ls.textContent="שמירה"; alert("אין חיבור."); });
  };
}

// -------------------------------------------------------- submittal / SD
function itemScreen(kind){
  var o=lists[kind];
  o.items = kind==="sd" ? (S.board.sd||[]) : (S.board.submittals||[]);
  o.kind=kind;
  AW.el().innerHTML=AW.head(kind==="sd"?"SD":"Submittal")+AW.itemList(o);
  AW.wireBack();
  AW.wireItemList(o, function(keep){ AW.render(!!keep); });
}
function standards(){
  // 07.11.26 — as in the subcontractor's app: the check and its date under it,
  // a done one pale green, no tick and no eye; the trade above each.
  AW.el().innerHTML=AW.head("בדיקות ומכון התקנים")+AW.standardsSimple(S.board.standards, true);
  AW.wireBack();
}

var fin={q:""};
function finishes(){ AW.finishesScreen(fin); }
function draw(v){
  if(!S.board) return;
  switch(v.v){
    case "weekly": return weekly(v.day);
    case "weekEdit": return weekEdit(v.trade);
    case "log": return logTrades();
    case "logTrade": return logTrade(v.trade);
    case "submittal": return itemScreen("submittal");
    case "sd": return itemScreen("sd");
    case "standards": return standards();
    case "finishes": return finishes();
    case "schedule": return PMSchedule.draw();
    case "rj": return AW.rejects.draw(v);
    case "tasks": case "taskCat": case "taskStatus": case "task": return PMTasks.draw(v);
    default: return home();
  }
}
AW.setBusyCheck(function(){ return !!(logDraft||weekBuf||AW.rejects.busy()||PMTasks.busy()); });
AW.boot({ render:draw });
})();
