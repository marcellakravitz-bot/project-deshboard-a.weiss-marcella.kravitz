// ---------------------------------------------------------------------------
// לו"ז פרויקט (07.11.26) — the project schedule uploaded on the dashboard,
// for project managers, to read only.
//   The list: the activity on the right (phases open and close, as on the
//   dashboard), its dates, expected and actual percent.
//   "גאנט" at the top: the activities with their bars, sized for a phone.
// ---------------------------------------------------------------------------
var PMSchedule = (function(){
  var E=AW.esc, S=AW.state;
  var collapsed=null, gantt=false;
  var DAY=864e5;

  function t0(iso){ var d=new Date(String(iso||"").slice(0,10)+"T00:00:00"); return isNaN(d) ? NaN : d.getTime(); }
  function finishEnd(t){ var f=t0(t.finish); return isNaN(f) ? NaN : f+DAY; }
  // The same reckoning as the dashboard: by the calendar between the start and
  // the end of the finish day.
  function expected(t){
    var s=t0(t.start), f=finishEnd(t), now=Date.now();
    if(isNaN(s)||isNaN(f)||f<=s||now<=s) return 0;
    if(now>=f) return 100;
    return Math.round((now-s)/(f-s)*100);
  }
  function status(t){
    if(Date.now()>finishEnd(t) && t.pc<100) return "red";
    var gap=expected(t)-t.pc;
    return gap<=0 ? "green" : gap<=40 ? "orange" : "red";
  }
  function dm(iso){ var p=String(iso||"").slice(0,10).split("-"); return p.length===3 ? p[2]+"."+p[1]+"."+p[0].slice(2) : ""; }

  function tasks(){ return (S.board&&S.board.schedule)||[]; }
  // Phases open; the ones inside them start closed, so the list fits a phone.
  function initCollapsed(){
    collapsed={};
    var list=tasks(), top=Math.min.apply(null, list.map(function(t){ return t.level; }).concat([99]));
    list.forEach(function(t){ if(t.sum && t.level>top) collapsed[t.id]=true; });
  }
  function hasKids(list, i){ return i+1<list.length && list[i+1].level>list[i].level; }
  function visible(){
    var list=tasks(), out=[], hideBelow=null;
    for(var i=0;i<list.length;i++){
      var t=list[i];
      if(hideBelow!==null){ if(t.level>hideBelow) continue; hideBelow=null; }
      out.push({t:t, kids:t.sum && hasKids(list,i)});
      if(t.sum && collapsed[t.id]) hideBelow=t.level;
    }
    return out;
  }
  function nameCell(row, top){
    var t=row.t, pad=Math.max(0, t.level-top)*12;
    return '<div class="schName'+(t.sum?" sum":"")+'" style="padding-inline-start:'+pad+'px">'+
      (row.kids ? '<button class="schCaret" data-id="'+E(t.id)+'" aria-label="'+(collapsed[t.id]?"פתיחה":"כיווץ")+'">'+(collapsed[t.id]?"‹":"⌄")+'</button>' : '<span class="schDot"></span>')+
      '<span class="nm">'+E(t.name)+'</span></div>';
  }
  function listHtml(rows, top){
    return '<table class="schTbl"><thead><tr><th>פעילות</th><th>תאריכים</th><th>צפוי</th><th>בפועל</th></tr></thead><tbody>'+
      rows.map(function(row){
        var t=row.t, st=status(t);
        return '<tr class="'+(t.sum?"sum":"")+'"><td>'+nameCell(row, top)+'</td>'+
          '<td class="dt num">'+E(dm(t.start))+'<br>'+E(dm(t.finish))+'</td>'+
          '<td class="pc num">'+expected(t)+'%</td>'+
          '<td class="pc num st-'+st+'">'+t.pc+'%</td></tr>';
      }).join("")+'</tbody></table>';
  }
  function ganttHtml(rows, top){
    var list=tasks(), lo=Infinity, hi=-Infinity;
    list.forEach(function(t){ var s=t0(t.start), f=finishEnd(t); if(!isNaN(s)&&s<lo) lo=s; if(!isNaN(f)&&f>hi) hi=f; });
    if(!isFinite(lo)||!isFinite(hi)||hi<=lo) return AW.empty("אין תאריכים בלו״ז.");
    var span=hi-lo, pct=function(x){ return Math.max(0, Math.min(100, (x-lo)/span*100)); };
    // The months along the top, the first letters only when they are close.
    var months=[], d=new Date(lo); d.setDate(1); d.setHours(0,0,0,0);
    while(d.getTime()<hi){
      var x=d.getTime();
      if(x>=lo) months.push({x:pct(x), t:(d.getMonth()+1)+"/"+String(d.getFullYear()).slice(2)});
      d.setMonth(d.getMonth()+1);
    }
    var step=Math.max(1, Math.ceil(months.length/6));
    var now=Date.now(), today=now>=lo&&now<=hi ? pct(now) : null;
    var axis='<div class="schAxis">'+months.map(function(m,i){
      return '<span class="tick" style="right:'+m.x+'%">'+(i%step===0?'<b class="num">'+E(m.t)+'</b>':"")+'</span>';
    }).join("")+'</div>';
    return '<div class="schG"><div class="gRow gHead"><div class="gName">פעילות</div><div class="gBars">'+axis+'</div></div>'+
      rows.map(function(row){
        var t=row.t, s=t0(t.start), f=finishEnd(t);
        var bar="";
        if(!isNaN(s)&&!isNaN(f)){
          var r=pct(s), w=Math.max(0.8, pct(f)-r);
          bar='<span class="gBar st-'+status(t)+(t.sum?" sum":"")+'" style="right:'+r+'%;width:'+w+'%"><i style="width:'+Math.max(0,Math.min(100,t.pc))+'%"></i></span>';
        }
        return '<div class="gRow'+(t.sum?" sum":"")+'"><div class="gName">'+nameCell(row, top)+'</div>'+
          '<div class="gBars">'+(today!==null?'<span class="gToday" style="right:'+today+'%"></span>':'')+bar+'</div></div>';
      }).join("")+'</div>'+
      '<p class="gLegend"><span class="st-green">■</span> לפי התכנון · <span class="st-orange">■</span> פיגור קל · <span class="st-red">■</span> פיגור · <span class="lt">│</span> היום</p>';
  }
  function draw(){
    if(!collapsed) initCollapsed();
    var list=tasks();
    var top=Math.min.apply(null, list.map(function(t){ return t.level; }).concat([99]));
    var rows=visible();
    var anyOpen=list.some(function(t,i){ return t.sum && hasKids(list,i) && !collapsed[t.id]; });
    if(!list.length){ AW.el().innerHTML=AW.head("לו״ז פרויקט")+AW.empty("טרם עלה לו״ז פרויקט"); AW.wireBack(); return; }
    AW.el().innerHTML=AW.head("לו״ז פרויקט")+
      '<div class="schBar"><button id="schGantt" class="chip'+(gantt?" on":"")+'">גאנט</button>'+
      '<button id="schAll" class="chip">'+(anyOpen?"כיווץ הכל":"פתיחת הכל")+'</button></div>'+
      (list.length ? (gantt ? ganttHtml(rows, top) : listHtml(rows, top)) : AW.empty("טרם עלה לו״ז פרויקט"));
    AW.wireBack();
    document.getElementById("schGantt").onclick=function(){ gantt=!gantt; AW.render(true); };
    document.getElementById("schAll").onclick=function(){
      collapsed={};
      if(anyOpen) list.forEach(function(t,i){ if(t.sum && hasKids(list,i)) collapsed[t.id]=true; });
      AW.render(true);
    };
    Array.prototype.forEach.call(AW.el().querySelectorAll(".schCaret"), function(b){
      b.onclick=function(e){ e.stopPropagation(); var id=b.getAttribute("data-id"); collapsed[id]=!collapsed[id]; AW.render(true); };
    });
  }
  return { draw:draw };
})();
