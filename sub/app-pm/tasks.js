// ---------------------------------------------------------------------------
// ניהול משימות — the project manager's app (06.11.26).
//
//   + משימה חדשה
//   סה"כ משימות - N
//   four squares, the traffic light: טרם בוצע · בטיפול · סגורות · לידיעה
//   every category of the dashboard (a new one appears by itself)
//
// A category opens its tasks, each row in its status colour. A task opens in
// full: he changes the status and the notes and adds updates on any task; the
// wording, category, owner and due date only on a task he opened. "שמירה" and
// "סגירה" both go back to the category. A task he has not opened yet blinks
// "משימה חדשה" beside its category, and then on itself, until he opens it.
// ---------------------------------------------------------------------------
var PMTasks = (function(){
  var E=AW.esc, S=AW.state;
  var ST=[
    {k:"open",     t:"טרם בוצע",    c:"#b42318", bg:"#fde4e2", bd:"#f6c5c0"},
    {k:"progress", t:"בטיפול",      c:"#a35c00", bg:"#feecd6", bd:"#f6d3a5"},
    {k:"done",     t:"סגורות",      c:"#1f7a3e", bg:"#e0f2e6", bd:"#b6dfc3"},
    {k:"info",     t:"לידיעה",      c:"#5f6672", bg:"#eff1f4", bd:"#dde1e6"}
  ];
  var STATUS_HE={open:"טרם בוצע", progress:"בטיפול", done:"בוצע", info:"לידיעה בלבד"};
  var stOf=function(k){ return ST.filter(function(s){ return s.k===k; })[0]||ST[0]; };
  var T=null, loading=false, draft=null, ed=null;

  (function css(){
    var s=document.createElement("style");
    s.textContent=
      '.tkTop{display:flex;justify-content:center;margin:0 0 6px}'+
      '.tkTotal{text-align:center;font-size:12px;color:var(--steel);margin:4px 0 8px}'+
      '.tkSq{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px}'+
      '.tkSq button{border:1px solid;border-radius:10px;padding:8px 2px 7px;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}'+
      '.tkSq button span{font-size:11.5px;font-weight:600}'+
      '.tkSq button b{font-size:17px;font-weight:700;font-family:Inter,sans-serif}'+
      '.tkCat{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;margin:0 0 6px;border:1px solid rgba(16,52,96,.16);'+
        'background:rgba(16,52,96,.07);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;font-weight:700;color:var(--navy);cursor:pointer;text-align:right}'+
      '.tkCat.h{cursor:default;margin-top:8px}'+
      '.tkNew{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:#1a5fd0;animation:tkBlink 1.1s ease-in-out infinite}'+
      '@keyframes tkBlink{0%,100%{opacity:1}50%{opacity:.25}}'+
      '@media (prefers-reduced-motion: reduce){.tkNew{animation:none}}'+
      '.tkRow{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 6px;border:1px solid;border-radius:10px;padding:9px 11px;font:inherit;color:var(--ink);cursor:pointer;text-align:right}'+
      '.tkRow .d{flex:1;font-size:13.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}'+
      '.tkRow .m{display:block;font-size:11px;color:var(--steel);margin-top:2px}'+
      '.tkEd{display:flex;flex-direction:column;gap:8px}'+
      '.tkEd .who{font-size:11.5px;color:var(--mist);text-align:center;line-height:1.6}'+
      '.tkEd .ro{font-size:14px;line-height:1.6;background:#f7f8fa;border:1px solid var(--line);border-radius:10px;padding:8px 10px;white-space:pre-wrap;overflow-wrap:anywhere}'+
      '.tkEd label{margin:2px 0 3px;color:var(--steel);font-size:11.5px}'+
      '.tkEd textarea,.tkEd input,.tkEd select{width:100%;font-size:16px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:#fff}'+
      '.tkEd textarea{min-height:64px;resize:vertical}'+
      '.tkEd .two{display:grid;grid-template-columns:1fr 1fr;gap:6px}'+
      '.stSeg{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}'+
      '.stSeg button{border:1px solid var(--line);background:#fff;border-radius:9px;padding:6px 2px;font:inherit;font-size:12px;font-weight:700;color:var(--steel);cursor:pointer}'+
      '.thin{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 14px;font:inherit;font-size:12.5px;font-weight:700;color:var(--navy);cursor:pointer}'+
      '.thin.dark{background:var(--panel);border-color:var(--panel);color:#fff}'+
      '.tkActs{display:flex;gap:8px;margin-top:6px}'+
      '.tkActs button{flex:1;padding:9px}'+
      '.upd{border-bottom:1px dashed var(--line);padding:8px 2px}'+
      '.upd small{display:block;font-size:11px;color:var(--mist);margin-bottom:2px}'+
      '.upd div{font-size:13.5px;line-height:1.6;white-space:pre-wrap}';
    document.head.appendChild(s);
  })();

  // ------------------------------------------------------------- seen marks
  function seenKey(){ return "awpm.tasksSeen|"+(S.project||""); }
  function seen(){ try{ return JSON.parse(localStorage.getItem(seenKey())||"null"); }catch(e){ return null; } }
  function saveSeen(a){ try{ localStorage.setItem(seenKey(), JSON.stringify(a)); }catch(e){} }
  function markSeen(id){ var a=seen()||[]; if(a.indexOf(id)<0){ a.push(id); saveSeen(a); } }
  function isNew(t){ var a=seen(); return !!a && a.indexOf(t.id)<0; }

  function load(quiet){
    if(loading) return Promise.resolve(false);
    loading=true;
    if(!quiet) AW.busy("טוען משימות…");
    return AW.call({action:"tasks", projectId:S.project}).then(function(r){
      loading=false;
      if(!r.ok){ if(!quiet) AW.retry("טעינת המשימות נכשלה.", function(){ load(false); }); return false; }
      var before=JSON.stringify(T&&T.tasks);
      T=r.data; T.at=Date.now();
      // The first time this phone opens the board, nothing on it is "new".
      if(!seen()) saveSeen((T.tasks||[]).map(function(t){ return t.id; }));
      return before!==JSON.stringify(T.tasks);
    }).catch(function(){ loading=false; if(!quiet) AW.retry("אין חיבור לרשת.", function(){ load(false); }); return false; });
  }
  function catName(k){ var c=(T.cats||[]).filter(function(x){ return x.key===k; })[0]; return c?c.he:"ללא קטגוריה"; }
  function catOf(t){ return (T.cats||[]).some(function(c){ return c.key===t.category; }) ? t.category : ""; }
  function row(t){
    var s=stOf(t.status);
    var meta=[t.owner?E(t.owner):"", t.due?'יעד <span class="num">'+E(AW.fmtShort(t.due))+'</span>':""].filter(Boolean).join(" · ");
    return '<button class="tkRow" data-t="'+E(t.id)+'" style="background:'+s.bg+';border-color:'+s.bd+'"><span class="d">'+E(t.desc||"ללא תיאור")+
      (meta?'<span class="m">'+meta+'</span>':'')+'</span>'+(isNew(t)?'<span class="tkNew">★ משימה חדשה</span>':'')+'</button>';
  }
  function wireRows(){
    Array.prototype.forEach.call(AW.el().querySelectorAll("[data-t]"), function(b){
      b.onclick=function(){ ed=null; AW.go({v:"task", id:b.getAttribute("data-t")}); };
    });
  }
  // A list screen redrawn now and then in the preview, with what is new.
  // 07.11.26 — kept fresh: a status changed on the dashboard shows here
  // within seconds, on the task itself too.
  function freshen(){
    if(T && Date.now()-T.at>4000 && !draft && !(ed && (ed.upd || ed.dirty))){
      load(true).then(function(ch){ if(ch) AW.render(true); });
    }
  }

  function main(){
    var app=AW.el(), list=T.tasks||[];
    var h=AW.head("ניהול משימות");
    if(draft){
      h+='<div class="form"><label>קטגוריה</label><select id="ndCat"><option value="">ללא קטגוריה</option>'+(T.cats||[]).map(function(c){
          return '<option value="'+E(c.key)+'"'+(c.key===draft.category?" selected":"")+'>'+E(c.he)+'</option>'; }).join("")+'</select>'+
        '<label>תיאור המשימה</label><textarea id="ndDesc" placeholder="מה צריך לעשות">'+E(draft.desc)+'</textarea>'+
        '<div class="two" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><div><label>אחריות</label><input id="ndOwner" value="'+E(draft.owner)+'"></div>'+
        '<div><label>תאריך יעד</label><input id="ndDue" type="date" value="'+E(draft.due)+'"></div></div>'+
        '<div class="row"><button id="ndSave">הוספה</button><button class="ghost" id="ndCancel">ביטול</button></div></div>';
    } else h+='<div class="tkTop"><button class="pill" id="tkNew">+ משימה חדשה</button></div>';
    h+='<div class="tkTotal">סה"כ משימות - '+list.length+'</div>';
    h+='<div class="tkSq">'+ST.map(function(s){
      var n=list.filter(function(t){ return (t.status||"open")===s.k; }).length;
      return '<button data-st="'+s.k+'" style="background:'+s.bg+';border-color:'+s.bd+';color:'+s.c+'"><span>'+s.t+'</span><b>'+n+'</b></button>';
    }).join("")+'</div>';
    var keys=(T.cats||[]).map(function(c){ return c.key; });
    if(list.some(function(t){ return !catOf(t); })) keys=keys.concat([""]);
    h+=keys.map(function(k){
      var fresh=list.some(function(t){ return catOf(t)===k && isNew(t); });
      return '<button class="tkCat" data-c="'+E(k)+'"><span>'+E(k?catName(k):"ללא קטגוריה")+'</span>'+(fresh?'<span class="tkNew">★ משימה חדשה</span>':'')+'</button>';
    }).join("");
    app.innerHTML=h;
    AW.wireBack();
    var nw=document.getElementById("tkNew"); if(nw) nw.onclick=function(){ draft={category:"",desc:"",owner:"",due:""}; AW.render(true); };
    var keep=function(){
      draft.category=document.getElementById("ndCat").value; draft.desc=document.getElementById("ndDesc").value;
      draft.owner=document.getElementById("ndOwner").value; draft.due=document.getElementById("ndDue").value;
    };
    var nc=document.getElementById("ndCancel"); if(nc) nc.onclick=function(){ draft=null; AW.render(true); };
    var ns=document.getElementById("ndSave");
    if(ns) ns.onclick=function(){
      keep();
      if(!draft.desc.trim()){ alert("צריך תיאור למשימה."); return; }
      ns.disabled=true; ns.textContent="שומר…";
      AW.call({action:"task-save", op:"add", projectId:S.project, fields:draft}).then(function(r){
        if(!r.ok){ ns.disabled=false; ns.textContent="הוספה"; alert("השמירה נכשלה."); return; }
        if(r.data&&r.data.task) markSeen(r.data.task.id);
        draft=null; load(true).then(function(){ AW.render(true); });
      }).catch(function(){ ns.disabled=false; ns.textContent="הוספה"; alert("אין חיבור."); });
    };
    Array.prototype.forEach.call(app.querySelectorAll("[data-st]"), function(b){ b.onclick=function(){ AW.go({v:"taskStatus", st:b.getAttribute("data-st")}); }; });
    Array.prototype.forEach.call(app.querySelectorAll("[data-c]"), function(b){ b.onclick=function(){ AW.go({v:"taskCat", cat:b.getAttribute("data-c")}); }; });
  }
  function byCat(cat){
    var ts=(T.tasks||[]).filter(function(t){ return catOf(t)===cat; });
    AW.el().innerHTML=AW.head(E(cat?catName(cat):"ללא קטגוריה"))+(ts.length?ts.map(row).join(""):AW.empty("אין משימות בקטגוריה הזו."));
    AW.wireBack(); wireRows();
  }
  function byStatus(st){
    var s=stOf(st), list=(T.tasks||[]).filter(function(t){ return (t.status||"open")===st; });
    var keys=(T.cats||[]).map(function(c){ return c.key; }).concat([""]);
    var h=AW.head(E(s.t));
    var any=false;
    keys.forEach(function(k){
      var ts=list.filter(function(t){ return catOf(t)===k; });
      if(!ts.length) return;
      any=true;
      h+='<div class="tkCat h"><span>'+E(k?catName(k):"ללא קטגוריה")+'</span></div>'+ts.map(row).join("");
    });
    AW.el().innerHTML=h+(any?"":AW.empty("אין משימות בסטטוס הזה."));
    AW.wireBack(); wireRows();
  }

  function task(id){
    var t=(T.tasks||[]).filter(function(x){ return x.id===id; })[0];
    if(!t){ history.back(); return; }
    markSeen(t.id);
    if(!ed || ed.id!==t.id || (!ed.dirty && !ed.upd)) ed={id:t.id, status:t.status||"open", notes:t.notes||"", desc:t.desc||"", owner:t.owner||"", due:t.due||"", category:t.category||"", upd:""};
    var own=t.mine&&!t.fixed;
    var who=t.fixed ? "משימה קבועה" : ("משימה נפתחה ע\"י "+E((t.createdBy&&t.createdBy.name)||"—")+(t.created?" בתאריך "+E(AW.fmtShort(t.created)):""));
    if(t.status==="done"&&t.doneBy&&t.doneBy.name) who+='<br>משימה עודכנה לסטטוס בוצע ע"י '+E(t.doneBy.name)+(t.doneAt?" בתאריך "+E(AW.fmtShort(t.doneAt)):"");
    var h=AW.head(E(catName(catOf(t))))+'<div class="form tkEd"><div class="who">'+who+'</div>';
    if(own){
      h+='<label>תיאור</label><textarea id="eDesc">'+E(ed.desc)+'</textarea>'+
        '<label>קטגוריה</label><select id="eCat"><option value="">ללא קטגוריה</option>'+(T.cats||[]).map(function(c){
          return '<option value="'+E(c.key)+'"'+(c.key===ed.category?" selected":"")+'>'+E(c.he)+'</option>'; }).join("")+'</select>'+
        '<div class="two"><div><label>אחריות</label><input id="eOwner" value="'+E(ed.owner)+'"></div>'+
        '<div><label>תאריך יעד</label><input id="eDue" type="date" value="'+E(ed.due)+'"></div></div>';
    } else {
      h+='<div class="ro">'+E(t.desc||"")+'</div>'+
        ((t.owner||t.due)?'<div class="who" style="color:var(--steel)">'+[t.owner?"אחריות: "+E(t.owner):"", t.due?"יעד: "+E(AW.fmtShort(t.due)):""].filter(Boolean).join(" · ")+'</div>':'');
    }
    h+='<label>סטטוס</label><div class="stSeg">'+ST.map(function(s){
      var on=s.k===ed.status;
      return '<button type="button" data-s="'+s.k+'" style="'+(on?'background:'+s.bg+';color:'+s.c+';border-color:'+s.c:'')+'">'+STATUS_HE[s.k]+'</button>';
    }).join("")+'</div>'+
      '<label>הערות</label><textarea id="eNotes" placeholder="הערות">'+E(ed.notes)+'</textarea>'+
      '<label>עדכון</label><textarea id="eUpd" placeholder="עדכון חדש" style="min-height:52px">'+E(ed.upd)+'</textarea>'+
      '<div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap"><button type="button" class="thin" id="eUpdGo">הוספת עדכון</button>'+
      '<button type="button" class="thin" id="eHist">צפייה בהיסטוריית עדכונים ('+(t.updates||[]).length+')</button></div>'+
      '<div class="tkActs"><button type="button" class="thin dark" id="eSave">שמירה</button><button type="button" class="thin" id="eClose">סגירה</button></div>'+
    '</div>';
    AW.el().innerHTML=h;
    AW.wireBack();
    Array.prototype.forEach.call(AW.el().querySelectorAll(".tkEd textarea,.tkEd input,.tkEd select"), function(x){
      x.addEventListener("input", function(){ if(x.id!=="eUpd") ed.dirty=true; else ed.upd=x.value; });
    });
    var keep=function(){
      ed.notes=document.getElementById("eNotes").value; ed.upd=document.getElementById("eUpd").value;
      if(own){ ed.desc=document.getElementById("eDesc").value; ed.owner=document.getElementById("eOwner").value;
        ed.due=document.getElementById("eDue").value; ed.category=document.getElementById("eCat").value; }
    };
    Array.prototype.forEach.call(AW.el().querySelectorAll("[data-s]"), function(b){
      b.onclick=function(){ keep(); ed.status=b.getAttribute("data-s"); ed.dirty=true; AW.render(true); };
    });
    document.getElementById("eHist").onclick=function(){
      var ups=(t.updates||[]).slice().reverse();
      AW.pop("היסטוריית עדכונים", ups.length ? ups.map(function(u){
        return '<div class="upd"><small>עודכן ע"י '+E(u.by||"—")+' בתאריך '+E(AW.fmtShort(u.date))+'</small><div>'+E(u.text)+'</div></div>';
      }).join("") : '<p class="lead">אין עדכונים עדיין.</p>');
    };
    document.getElementById("eUpdGo").onclick=function(){
      keep();
      var tx=String(ed.upd||"").trim();
      if(!tx){ alert("צריך לכתוב את העדכון."); return; }
      var b=this; b.disabled=true;
      AW.call({action:"task-save", op:"update", projectId:S.project, taskId:t.id, text:tx}).then(function(r){
        b.disabled=false;
        if(!r.ok){ alert("השמירה נכשלה."); return; }
        ed.upd=""; load(true).then(function(){ AW.render(true); AW.toast(r.data&&r.data.preview?"תצוגה מקדימה — השינוי לא נשמר":"העדכון נוסף"); });
      }).catch(function(){ b.disabled=false; alert("אין חיבור."); });
    };
    document.getElementById("eClose").onclick=function(){ ed=null; history.back(); };
    document.getElementById("eSave").onclick=function(){
      keep();
      var f={};
      if(ed.status!==(t.status||"open")) f.status=ed.status;
      if(ed.notes!==(t.notes||"")) f.notes=ed.notes;
      if(own){
        if(ed.desc.trim() && ed.desc!==t.desc) f.desc=ed.desc;
        if(ed.owner!==(t.owner||"")) f.owner=ed.owner;
        if(ed.due!==(t.due||"")) f.due=ed.due;
        if(ed.category!==(t.category||"")) f.category=ed.category;
      }
      var finish=function(){ ed=null; history.back(); };
      if(!Object.keys(f).length){ finish(); return; }
      var b=this; b.disabled=true; b.textContent="שומר…";
      AW.call({action:"task-save", op:"patch", projectId:S.project, taskId:t.id, fields:f}).then(function(r){
        if(!r.ok){ b.disabled=false; b.textContent="שמירה"; alert(r.status===403?"אפשר לערוך רק משימה שהקמת.":"השמירה נכשלה."); return; }
        load(true).then(finish);
      }).catch(function(){ b.disabled=false; b.textContent="שמירה"; alert("אין חיבור."); });
    };
  }

  function draw(v){
    if(!T){ load(false).then(function(){ if(T) AW.render(); }); return; }
    freshen();
    if(v.v==="task") return task(v.id);
    ed=null;
    if(v.v==="taskCat") return byCat(v.cat||"");
    if(v.v==="taskStatus") return byStatus(v.st);
    return main();
  }
  // In the preview the board is asked again every few seconds.
  if(AW.PREVIEW) setInterval(function(){
    var v=AW.view().v;
    if(["tasks","taskCat","taskStatus","task"].indexOf(v)>=0 && !document.querySelector(".pop")) freshen();
  }, 6000);
  return { draw:draw, busy:function(){ return !!(draft||(ed&&(ed.upd||ed.dirty))); }, reset:function(){ T=null; ed=null; } };
})();
