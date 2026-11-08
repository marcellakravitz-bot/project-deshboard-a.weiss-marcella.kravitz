// ---------------------------------------------------------------------------
// A. Weiss apps — shared code (06.11.26).
//
// One entry link for everybody (sub/index.html: phone + code, then the
// project). From there each kind of user goes to an app of its own, each in
// its own folder:
//   app-pm/      project manager
//   app-sub/     subcontractor (one trade, view only)
//   app-client/  client and supervision
// This file holds only what every one of them needs: talking to the server,
// the sign-in kept on the phone, the dashboard's live preview, and small
// drawing helpers. No app's screens live here.
// ---------------------------------------------------------------------------
var AW = (function(){
  var API = "https://jvssavyfjuhjniqkiymo.supabase.co/functions/v1/sub-portal";
  var RJ_API = "https://jvssavyfjuhjniqkiymo.supabase.co/functions/v1/sub-rejects";
  var TOKEN_KEY = "awsub.token";
  var SEEN_KEY = "awsub.seen";

  var q = new URLSearchParams(location.search);
  // The dashboard's preview ("אפליקציות" > תצוגה מקדימה): the administrator's
  // own sign-in, real projects, and nothing is written.
  var PREVIEW = q.get("preview") ? { who: q.get("preview") } : null;

  var TRADES = [
    {k:"hvac",t:"מיזוג אוויר"},{k:"electric",t:"חשמל"},{k:"plumbing",t:"אינסטלציה"},
    {k:"drywall",t:"גבס"},{k:"security",t:"ביטחון, בקרה ותקשורת"},{k:"paint",t:"צבע"}
  ];
  var CAT_HE = { electrical:"חשמל", lighting:"תאורה", security:"ביטחון, בקרה ותקשורת",
    hvac:"מיזוג אוויר", plumbing:"אינסטלציה", ceiling:"תקרה", flooring:"ריצוף",
    cladding:"גמרים", architecture:"אדריכלות", av:"מולטימדיה", fire:"גילוי אש" };
  var DECISIONS = {
    approved:      { t:"מאושר",                  c:"#1a7f4b", bg:"#e3f3e6" },
    approvedNoted: { t:"מאושר בכפוף להערות",     c:"#2f7d8f", bg:"#e2f1f4" },
    revise:        { t:"הגשה חדשה בכפוף להערות", c:"#b26a00", bg:"#fdeed8" },
    rejected:      { t:"לא מאושר",               c:"#c0392b", bg:"#fbe3e3" }
  };
  var SD_STATUS = {
    required:{t:"נדרש"}, requested:{t:"נתבקש"}, submitted:{t:"הוגש"},
    approved:{t:"מאושר",c:"#1a7f4b",bg:"#e3f3e6"}, approvedNoted:{t:"מאושר בכפוף להערות",c:"#2f7d8f",bg:"#e2f1f4"},
    revise:{t:"להגשה חוזרת",c:"#b26a00",bg:"#fdeed8"}, rejected:{t:"לא מאושר",c:"#c0392b",bg:"#fbe3e3"}
  };
  var ROLE_HE = { pm:"מנהל פרויקט", sub:"קבלן", client:"לקוח / אדריכלים", supervision:"פיקוח" };
  var APP_DIR = { pm:"app-pm", sub:"app-sub", client:"app-client", supervision:"app-client" };

  var state = { token:null, projects:[], project:null, board:null, floor:null };

  function esc(x){ return String(x==null?"":x).replace(/[&<>"]/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
  function icon(path){
    return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" '+
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="'+path+'"/></svg>';
  }
  function fmt(iso){
    if(!iso) return "";
    var p=String(iso).slice(0,10).split("-");
    return p.length===3 ? p[2]+"."+p[1]+"."+p[0] : String(iso);
  }
  // "6/11/26" — the short date of an update.
  function fmtShort(iso){
    var p=String(iso||"").slice(0,10).split("-");
    return p.length===3 ? Number(p[2])+"/"+Number(p[1])+"/"+p[0].slice(2) : String(iso||"");
  }
  function tradeHe(k){ var t=TRADES.filter(function(x){ return x.k===k; })[0]; return t?t.t:(k||""); }
  function todayIso(){ var d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10); }

  // ------------------------------------------------------------------ server
  // 07.11.26 — the finishes list is a read too (it was missing: the preview got an empty list).
  var PV_READ={projects:1,board:1,tasks:1,vapid:1,lists:1,list:1,finishes:1};
  function pvToken(){
    try{ var t=window.parent&&window.parent!==window&&window.parent.__awAccessToken; if(t) return t; }catch(e){}
    try{
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i);
        if(!/^sb-.*-auth-token$/.test(k)) continue;
        var v=JSON.parse(localStorage.getItem(k)||"null");
        if(v&&v.access_token) return v.access_token;
        if(v&&v.currentSession&&v.currentSession.access_token) return v.currentSession.access_token;
      }
    }catch(e){}
    return "";
  }
  function toast(msg){
    var old=document.querySelector(".pvToast"); if(old) old.remove();
    var d=document.createElement("div"); d.className="pvToast"; d.textContent=msg;
    document.body.appendChild(d); setTimeout(function(){ d.remove(); },2200);
  }
  function pvGuard(body){
    if(!PREVIEW) return null;
    body.preview={as:PREVIEW.who, accessToken:pvToken()};
    if(PV_READ[body.action]) return null;
    toast("תצוגה מקדימה — השינוי לא נשמר");
    return Promise.resolve({ ok:true, status:200, data:{ ok:true, preview:true } });
  }
  function post(url, body){
    var g=pvGuard(body); if(g) return g;
    return fetch(url,{ method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body) })
      .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, status:r.status, data:j }; },
        function(){ return { ok:false, status:r.status, data:{} }; }); });
  }
  function call(body){
    body.token=body.token||state.token;
    // 07.11.26 — what he writes with a floor chosen is for that floor.
    if(state.floor && state.floor!=="*" && (body.action==="add-log"||body.action==="set-week") && body.floor===undefined) body.floor=state.floor;
    return post(API, body);
  }
  function rjCall(body){ body.token=state.token; body.projectId=state.project; return post(RJ_API, body); }

  // ------------------------------------------------------------------ screen
  var app=null;
  function el(){ return app||(app=document.getElementById("app")); }
  function busy(text){ el().innerHTML='<p class="lead">'+esc(text||"טוען…")+'</p>'; }
  function retry(msg, again){
    el().innerHTML='<div class="card" style="text-align:center"><p class="hint" style="margin:0 0 14px">'+esc(msg)+
      '</p><button class="go" id="rt">נסו שוב</button></div>';
    document.getElementById("rt").onclick=again||function(){ location.reload(); };
  }
  function empty(msg){ return '<div class="empty">'+esc(msg)+'</div>'; }
  function head(title){ return '<div class="head"><button class="back" id="b">→ חזרה</button><h2>'+title+'</h2></div>'; }
  function wireBack(){ var b=document.getElementById("b"); if(b) b.onclick=function(){ history.back(); }; }
  function files(list){
    if(!list||!list.length) return "";
    return '<div class="files">'+list.map(function(f){
      var img=/^image\//.test(f.type||"");
      return '<a class="file'+(img?" img":"")+'" href="'+esc(f.url)+'" target="_blank" rel="noopener">'+
        (img ? '<img src="'+esc(f.url)+'" alt="">' : esc(f.name||"קובץ"))+'</a>';
    }).join("")+'</div>';
  }
  function isDoc(f){ return /html/.test((f&&f.type)||"") || /\.html(\?|$)/i.test((f&&f.url)||""); }
  // A signed submittal (an HTML page) opens inside the app, fitted to the phone.
  // 07.11.26 — the form opens over the list like a picture of the printed
  // page: laid out at its own A4 width and shrunk to the phone's, never
  // reflowed (which bent its rows). The X closes it, back to the list.
  function openDoc(url){
    var box=document.createElement("div");
    box.className="docView";
    box.innerHTML='<div class="docTop"><button class="docX" type="button" aria-label="סגירה">✕</button></div><div class="docBody"><p class="lead">טוען את הטופס…</p></div>';
    document.body.appendChild(box);
    // 09.11.26 — like a window: the phone's back closes it, the list stays.
    history.pushState({awPop:1},"");
    var close=function(){ if(!box.parentNode) return; box.remove(); if(history.state && history.state.awPop){ closingPop=true; history.back(); } };
    box.querySelector(".docX").onclick=close;
    fetch(url).then(function(r){ return r.text(); }).then(function(html){
      var W=794, body=box.querySelector(".docBody");
      var css='<style>html,body{margin:0!important;padding:0!important;background:#fff!important;width:'+W+'px!important}.page{margin:0 0 12px!important;box-shadow:none!important}</style>';
      body.innerHTML='<div class="docScale"><iframe scrolling="no"></iframe></div>';
      var fr=body.querySelector("iframe"), wrap=body.querySelector(".docScale");
      fr.style.width=W+"px";
      fr.onload=function(){
        try{
          var d=fr.contentDocument, h=Math.max(d.documentElement.scrollHeight, d.body.scrollHeight);
          var k=Math.min(1, (body.clientWidth-12)/W);
          fr.style.height=h+"px"; fr.style.transform="scale("+k+")";
          wrap.style.width=(W*k)+"px"; wrap.style.height=(h*k)+"px";
        }catch(e){}
      };
      fr.srcdoc=String(html||"").replace(/window\.print\(\)/g,"void 0").replace(/<\/head>/i, css+'</head>');
    }).catch(function(){ box.querySelector(".docBody").innerHTML='<p class="lead">לא ניתן לפתוח את הטופס.</p>'; });
  }
  function openFile(f){ if(!f||!f.url) return; if(isDoc(f)) openDoc(f.url); else window.open(f.url,"_blank","noopener"); }
  // A small window from the bottom of the screen.
  function pop(title, html, center){
    var box=document.createElement("div");
    box.className="pop"+(center?" popC":"");
    box.innerHTML='<div class="popCard">'+(title?'<h3>'+title+'</h3>':'')+html+'<button class="x" type="button">סגירה</button></div>';
    document.body.appendChild(box);
    // 09.11.26 — a window is a step of its own in the history: the phone's
    // back closes it and stays on the screen under it (it used to close the
    // window AND leave the screen, which looked like a jump home).
    history.pushState({awPop:1},"");
    box.__aw=true;
    var close=function(){ if(!box.parentNode) return; box.remove(); if(history.state && history.state.awPop) { closingPop=true; history.back(); } };
    box.onclick=function(e){ if(e.target===box) close(); };
    box.querySelector(".x").onclick=close;
    return box;
  }
  function shrink(file){
    return new Promise(function(res){
      if(!file||!/^image\//.test(file.type||"")){ res(null); return; }
      var url=URL.createObjectURL(file), img=new Image();
      img.onload=function(){
        var sc=Math.min(1,1600/Math.max(img.width,img.height)), c=document.createElement("canvas");
        c.width=Math.max(1,Math.round(img.width*sc)); c.height=Math.max(1,Math.round(img.height*sc));
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        URL.revokeObjectURL(url);
        res({ name:(file.name||"photo")+".jpg", type:"image/jpeg", data:c.toDataURL("image/jpeg",0.82) });
      };
      img.onerror=function(){ URL.revokeObjectURL(url); res(null); };
      img.src=url;
    });
  }
  function thumb(file){
    return new Promise(function(res){
      var url=URL.createObjectURL(file), img=new Image();
      img.onload=function(){
        var sc=Math.min(1,480/Math.max(img.width,img.height)), c=document.createElement("canvas");
        c.width=Math.max(1,Math.round(img.width*sc)); c.height=Math.max(1,Math.round(img.height*sc));
        var g=c.getContext("2d"); g.fillStyle="#fff"; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
        URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg",0.72));
      };
      img.onerror=function(){ URL.revokeObjectURL(url); res(""); };
      img.src=url;
    });
  }

  // ------------------------------------------------------------------ weeks
  function sundayOf(d){
    var x=new Date(d.getTime()); x.setHours(0,0,0,0); x.setDate(x.getDate()-x.getDay());
    return new Date(x.getTime()-x.getTimezoneOffset()*6e4).toISOString().slice(0,10);
  }
  function shiftWeek(isoDay,weeks){ var d=new Date(isoDay+"T00:00:00"); d.setDate(d.getDate()+weeks*7); return sundayOf(d); }
  function weekDays(isoDay){
    var names=["ראשון","שני","שלישי","רביעי","חמישי","שישי"], base=new Date(isoDay+"T00:00:00");
    return names.map(function(n,i){
      var d=new Date(base); d.setDate(d.getDate()+i);
      return { name:n, iso:new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10) };
    });
  }
  // The week as a timetable: one row a day. cellOf(i) gives the day's HTML.
  function timetable(wk, cellOf){
    var days=weekDays(wk), today=todayIso();
    return '<table class="tt"><tbody>'+days.map(function(d,i){
      var c=cellOf(i);
      return '<tr data-day="'+i+'" class="'+(d.iso===today?"today":"")+'"><th>'+d.name+'<span class="num">'+esc(fmt(d.iso).slice(0,5))+'</span></th>'+
        '<td class="'+(c?"":"none")+'">'+(c||"—")+'</td></tr>';
    }).join("")+'</tbody></table>';
  }

  // -------------------------------------------------------------- new marks
  function seenAll(){ try { return JSON.parse(localStorage.getItem(SEEN_KEY)||"{}"); } catch(e){ return {}; } }
  function seenKey(k){ return (state.project||"")+"|"+((state.board&&state.board.trade)||"")+"|"+k; }
  function isNew(k){ var m=(state.board&&state.board.marks)||{}; return !!m[k] && seenAll()[seenKey(k)]!==m[k]; }
  function markSeen(k){
    var m=(state.board&&state.board.marks)||{}; if(!m[k]) return;
    var all=seenAll(); all[seenKey(k)]=m[k];
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(all)); } catch(e){}
  }
  function markAllSeen(){
    var m=(state.board&&state.board.marks)||{}, all=seenAll();
    Object.keys(m).forEach(function(k){ all[seenKey(k)]=m[k]; });
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(all)); } catch(e){}
  }

  // ------------------------------------------------------------- the project
  // Logo, name, floors and dates — shown on the opening screen only.
  function projHead(line){
    var p=(state.board&&state.board.project)||{};
    return '<div class="proj">'+
      (p.logo ? '<img src="'+esc(p.logo)+'" alt="">' : '')+
      '<span class="pn">'+esc(p.name||"")+'</span>'+
      (p.floors ? '<span class="pf">'+esc(p.floors)+'</span>' : '')+
      (p.dates ? '<span class="pd num">'+esc(p.dates)+'</span>' : '')+
      (line ? '<span class="ptr">'+esc(line)+'</span>' : '')+
      floorChip()+
    '</div>';
  }

  // ------------------------------------------------------------- the floor
  // 07.11.26 — on a project with floors, after the project comes the floor:
  // one of his, or "כל הקומות" — always there, the whole project. A user
  // set for every floor is not asked. Asked once each time the app is opened;
  // the chip under the project changes it. state.floor: "5", or "*" for all.
  function floorKey(){ return "awsub.floor|"+state.project; }
  function myFloors(){ var b=state.board||{}; return Array.isArray(b.myFloors)?b.myFloors:[]; }
  // 07.11.26 — set for every floor: everything, as before, nothing to choose.
  function needsPick(){ return myFloors().length>0 && !b_all(); }
  function b_all(){ return !!(state.board&&state.board.allFloors); }
  function floorChip(){
    if(!needsPick()) return '';
    return '<button class="floorChip" type="button">'+(state.floor&&state.floor!=="*"?'קומה <b class="num">'+esc(state.floor)+'</b>':'כל הקומות')+' <span class="chg">החלפה</span></button>';
  }
  function floorPicker(){
    var f=myFloors(), p=(state.board&&state.board.project)||{};
    el().innerHTML='<div class="proj">'+(p.logo?'<img src="'+esc(p.logo)+'" alt="">':'')+'<span class="pn">'+esc(p.name||"")+'</span></div>'+
      '<h2 class="flTitle">בחירת קומה</h2>'+
      '<div class="flGrid">'+f.map(function(x){ return '<button class="flBtn num" data-f="'+esc(x)+'">'+esc(x)+'</button>'; }).join("")+'</div>'+
      '<div class="flAllBar"><button class="flAll" data-f="*">כל הקומות</button></div>';
    Array.prototype.forEach.call(el().querySelectorAll("[data-f]"), function(b){
      b.onclick=function(){ chooseFloor(b.getAttribute("data-f")); };
    });
  }
  function chooseFloor(fl){
    state.floor=fl||"*";
    try{ sessionStorage.setItem(floorKey(), state.floor); }catch(e){}
    stack.length=0;
    loadBoard(false);
  }
  document.addEventListener("click", function(e){
    var t=e.target && e.target.closest && e.target.closest(".floorChip");
    if(t){ e.preventDefault(); floorPicker(); }
  });

  // ------------------------------------------------------------- navigation
  // Every screen is a step pushed on the browser's history, so the phone's own
  // back gesture and the "חזרה" on screen do the same thing.
  var stack=[], renderFn=null;
  function view(){ return stack.length ? stack[stack.length-1] : {v:"home"}; }
  function go(v){ stack.push(v); history.pushState({aw:stack.length},""); render(); }
  function replace(v){ if(stack.length) stack[stack.length-1]=v; else stack.push(v); render(); }
  function render(keepScroll){
    if(state.board && state.floor===null && needsPick()){ floorPicker(); return; }
    var y=window.scrollY;
    if(renderFn) renderFn(view());
    window.scrollTo(0, keepScroll?y:0);
  }
  var closingPop=false;
  // 09.11.26 — the screen is read from the step the browser landed on, so
  // the app and the browser never disagree about where "back" leads.
  window.addEventListener("popstate", function(e){
    var open=document.querySelector(".pop, .docView");
    if(open) open.remove();
    if(closingPop){ closingPop=false; return; }
    var st=e.state||{};
    if(st.awPop) return;
    var n=Number(st.aw)||0;
    if(n<stack.length){ stack.length=n; render(); return; }
    if(!open && n===0 && !stack.length) toEntry();
  });
  function toEntry(){
    location.href="../index.html"+(PREVIEW?"?preview="+encodeURIComponent(PREVIEW.who):"");
  }
  function signOut(msg){
    try{ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY+".projects"); }catch(e){}
    location.href="../index.html"+(msg?"?msg="+encodeURIComponent(msg):"");
  }

  // ------------------------------------------------------------------- boot
  // Opens an app on the project in its address (?p=…): the board is fetched,
  // and the app draws it.
  function boot(opts){
    renderFn=opts.render;
    var out=document.getElementById("out");
    // In the preview "יציאה" goes back to the projects; nobody is signed out.
    if(PREVIEW){ document.body.classList.add("isPv"); if(out){ out.hidden=false; out.onclick=toEntry; } }
    else if(out){ out.hidden=false; out.onclick=function(){ signOut(); }; }
    state.project=q.get("p")||"";
    state.token=PREVIEW ? "preview" : (function(){ try{ return localStorage.getItem(TOKEN_KEY); }catch(e){ return null; } })();
    try{ state.projects=JSON.parse(localStorage.getItem(TOKEN_KEY+".projects")||"[]"); }catch(e){ state.projects=[]; }
    if(!state.token || !state.project){ toEntry(); return; }
    // 07.11.26 — the floor chosen earlier in this visit goes with the first
    // request, so the project is fetched once, not twice.
    try{ var sv=sessionStorage.getItem(floorKey()); if(sv) state.floor=sv; }catch(e){}
    loadBoard(false).then(function(){ if(opts.ready) opts.ready(); });
    if(PREVIEW){
      setInterval(function(){ refresh(false); }, 12000);
      window.addEventListener("message", function(e){
        if(e.origin!==location.origin) return;
        var d=e.data||{};
        if(d.type==="aw-preview" && d.refresh) refresh(true);
      });
    }
  }
  function loadBoard(quiet){
    if(!quiet) busy("טוען את הפרויקט…");
    var body={action:"board", projectId:state.project};
    if(state.floor) body.floor=state.floor;
    if(q.get("trade")) body.trade=q.get("trade");
    return call(body).then(function(r){
      if(r.ok){
        var first=!state.board;
        state.board=r.data;
        if(first){
          var fk="awsub.first|"+state.project+"|"+(state.board.trade||"");
          try{ if(localStorage.getItem(fk)!=="1"){ markAllSeen(); localStorage.setItem(fk,"1"); } }catch(e){}
        }
        var mf=myFloors();
        if(state.floor && state.floor!=="*" && mf.indexOf(state.floor)<0){ state.floor=null; try{ sessionStorage.removeItem(floorKey()); }catch(e){} }
        if(state.floor===null){
          var saved=null; try{ saved=sessionStorage.getItem(floorKey()); }catch(e){}
          if(saved!==null && (saved==="*" || mf.indexOf(saved)>=0)){ state.floor=saved; return loadBoard(quiet); }
          else if(needsPick()){ if(!quiet) floorPicker(); return true; }
          else state.floor="";
        }
        if(!quiet) render();
        return true;
      }
      if(r.status===401){ if(PREVIEW) retry("התצוגה המקדימה זמינה רק כשמחוברים לדשבורד כמנהלת."); else signOut("ההרשאה כבר לא בתוקף. פנו למנהלת הפרויקט."); return false; }
      retry("השרת לא זמין כרגע. "+((r.data&&r.data.detail)||""), function(){ loadBoard(false); });
      return false;
    }).catch(function(){ retry("אין חיבור לרשת.", function(){ loadBoard(false); }); return false; });
  }
  // Live in the preview: fetched again every few seconds, redrawn only when
  // something changed and nothing is being typed.
  var busyCheck=function(){ return false; };
  function refresh(force){
    if(!state.board) return;
    var a=document.activeElement;
    if(!force && (document.hidden || (a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) || busyCheck() || document.querySelector(".pop"))) return;
    var before=JSON.stringify(state.board);
    loadBoard(true).then(function(ok){
      if(ok && (force || JSON.stringify(state.board)!==before)) render(true);
    });
  }

  return {
    API:API, PREVIEW:PREVIEW, TRADES:TRADES, CAT_HE:CAT_HE, DECISIONS:DECISIONS, SD_STATUS:SD_STATUS,
    ROLE_HE:ROLE_HE, APP_DIR:APP_DIR, TOKEN_KEY:TOKEN_KEY, state:state,
    esc:esc, icon:icon, fmt:fmt, fmtShort:fmtShort, tradeHe:tradeHe, todayIso:todayIso,
    call:call, rjCall:rjCall, post:post, toast:toast,
    busy:busy, retry:retry, empty:empty, head:head, wireBack:wireBack, files:files, isDoc:isDoc,
    openDoc:openDoc, openFile:openFile, pop:pop, shrink:shrink, thumb:thumb,
    sundayOf:sundayOf, shiftWeek:shiftWeek, weekDays:weekDays, timetable:timetable,
    isNew:isNew, markSeen:markSeen, projHead:projHead, floorPicker:floorPicker,
    view:view, go:go, replace:replace, render:render, boot:boot, loadBoard:loadBoard, refresh:refresh,
    setBusyCheck:function(f){ busyCheck=f; }, signOut:signOut, toEntry:toEntry,
    el:el
  };
})();

// --------------------------------------------------------------------------
// Shared screens: the list of submittals / SD rows with search and filters,
// and the checks of the standards institute. Used by the project manager and
// the subcontractor apps alike.
// --------------------------------------------------------------------------
// 07.11.26 — a line with no type mark is named by its description: the first
// line of it, cut to what fits a row.
AW.shortLine = function(s){
  var t=String(s||"").split("\n")[0].replace(/\s+/g," ").trim();
  return t.length>60 ? t.slice(0,58).replace(/[\s,.;:-]+\S*$/,"")+"…" : t;
};
AW.itemList = function(o){
  // o: { items, kind: "submittal"|"sd", key (state holder) }
  var E=AW.esc, f=o.filter||{}, items=o.items||[];
  var catName=function(c, r){ return (r&&r.catHe)||AW.CAT_HE[c]||c||"ללא קטגוריה"; };
  var cats=[], types=[];
  items.forEach(function(r){
    if(r.category && cats.indexOf(r.category)<0) cats.push(r.category);
    if(r.typeId && types.indexOf(r.typeId)<0 && (!f.cat || r.category===f.cat)) types.push(r.typeId);
  });
  types.sort();
  var needle=String(f.q||"").trim().toLowerCase();
  var shown=items.filter(function(r){
    if(f.cat && r.category!==f.cat) return false;
    if(f.type && r.typeId!==f.type) return false;
    if(needle && [r.typeId,r.description,r.no,r.code,catName(r.category)].join(" ").toLowerCase().indexOf(needle)<0) return false;
    return true;
  });
  var stOf=function(r){
    if(o.kind==="sd"){ var s=AW.SD_STATUS[r.status]||{t:r.status||"נדרש"}; return {t:s.t,c:s.c||"#5b5e66",bg:s.bg||"#f1f2f4"}; }
    var d=AW.DECISIONS[r.decision];
    if(d) return d;
    return r.submitted ? {t:"הוגש",c:"#5b5e66",bg:"#eef2f7"} : {t:"טרם הוגש",c:"#9a9da5",bg:"#f4f5f7"};
  };
  // 06.11.26 — the subcontractor's list is plain: free search only, and each
  // row coloured by where it stands — submitted orange, approved green, not
  // approved red.
  var tone=function(r){
    var k = o.kind==="sd" ? r.status : (r.decision || (r.submitted ? "submitted" : ""));
    if(k==="approved"||k==="approvedNoted") return {bg:"#e0f2e6",bd:"#b6dfc3"};
    if(k==="rejected") return {bg:"#fde4e2",bd:"#f6c5c0"};
    if(k==="submitted"||k==="revise"||k==="requested") return {bg:"#feecd6",bd:"#f6d3a5"};
    return null;
  };
  var h= o.simple ? '<div class="find"><input id="fq" type="search" placeholder="חיפוש חופשי" value="'+E(f.q||"")+'"></div>' :
    '<div class="find"><input id="fq" type="search" placeholder="חיפוש חופשי" value="'+E(f.q||"")+'">'+
    // SD has no categories on the dashboard: the type marks only.
    (o.kind==="sd" ? '<div>' : '<div class="two"><select id="fc"><option value="">כל הקטגוריות</option>'+cats.map(function(c){
      return '<option value="'+E(c)+'"'+(f.cat===c?" selected":"")+'>'+E(catName(c))+'</option>'; }).join("")+'</select>')+
    '<select id="ft"><option value="">כל האיפיונים</option>'+types.map(function(t){
      return '<option value="'+E(t)+'"'+(f.type===t?" selected":"")+'>'+E(t)+'</option>'; }).join("")+'</select></div></div>';
  if(!shown.length) h+=AW.empty(items.length?"אין תוצאות לחיפוש.":"אין פריטים להצגה.");
  shown.forEach(function(r){
    var id=r.id||r.code, st=stOf(r), open=f.open===id && o.kind!=="sd";
    var tn=o.simple?tone(r):null;
    // 07.11.26 — SD: the category's icon, the type mark, the category.
    // SD has no category column on the dashboard: the icon reads the
    // category when there is one, otherwise the words of the description,
    // and the line under the type mark is the description.
    var sdSub=String(r.description||"").split("\n")[0];
    var pic = o.kind==="sd" ? '<span class="pic catIc">'+AW.catIcon(r.category, (r.catHe||"")+" "+(r.description||""))+'</span>'
      // 07.11.26 — a submittal with no picture: a picture icon in the square.
      : (r.image?'<img class="pic" src="'+E(r.image)+'" alt="">':'<span class="pic catIc noImg">'+AW.icon("M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5a1.5 1.5 0 1 0 0-.01")+'</span>');
    h+='<button class="item" data-id="'+E(id)+'"'+(tn?' style="background:'+tn.bg+';border-color:'+tn.bd+'"':'')+'>'+pic+
      '<span class="tx"><b>'+E(o.kind==="sd" ? (r.typeId||"—") : (r.typeId||r.no||AW.shortLine(r.description)||r.code||"—"))+'</b><span>'+E(o.kind==="sd" ? (sdSub||"—") : catName(r.category, r))+'</span></span>'+
      '<span class="st" style="color:'+st.c+';background:'+st.bg+'">'+E(st.t)+'</span></button>';
    if(open){
      var doc=r.doc || ((r.files||[]).filter(AW.isDoc)[0]) || null;
      var others=(r.files||[]).filter(function(x){ return !AW.isDoc(x); });
      h+='<div class="itemOpen">'+(r.no?'<div class="lbl">'+E(r.no)+'</div>':'')+
        '<p>'+E(r.description||"—")+'</p>'+
        (doc?'<div class="acts"><button class="eyeBtn" type="button" data-doc="'+E(id)+'">'+AW.icon("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")+'<span>צפייה בטופס</span></button></div>':'')+
        (o.kind==="sd"&&others.length?AW.files(others):'')+
      '</div>';
    }
  });
  return h;
};
AW.wireItemList = function(o, onChange){
  var f=o.filter;
  var q=document.getElementById("fq");
  if(q) q.oninput=function(){ f.q=q.value; onChange(true); var n=document.getElementById("fq"); if(n){ n.focus(); n.setSelectionRange(n.value.length,n.value.length); } };
  var c=document.getElementById("fc"); if(c) c.onchange=function(){ f.cat=c.value; f.type=""; onChange(); };
  var t=document.getElementById("ft"); if(t) t.onchange=function(){ f.type=t.value; onChange(); };
  Array.prototype.forEach.call(document.querySelectorAll(".item[data-id]"), function(b){
    b.onclick=function(){
      var id=b.getAttribute("data-id");
      if(o.kind==="sd"){ var r=(o.items||[]).filter(function(x){ return x.code===id; })[0]; if(r) AW.sdCard(r); return; }
      f.open=f.open===id?null:id; onChange(true);
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-doc]"), function(b){
    b.onclick=function(){
      var id=b.getAttribute("data-doc");
      var r=(o.items||[]).filter(function(x){ return (x.id||x.code)===id; })[0];
      if(!r) return;
      var doc=r.doc || ((r.files||[]).filter(AW.isDoc)[0]) || (r.files||[])[0];
      AW.openFile(doc);
    };
  });
};
// 07.11.26 — an SD drawing, in a card in the middle of the screen: the
// description, the date it is due, its file, and its updates in a window of
// their own (a date and the update beside it).
AW.sdCard = function(r){
  var E=AW.esc;
  var files=r.files||[];
  var ups=(r.updates||[]).slice().reverse();
  // 07.11.26 — centred, all but the text of the description.
  var box=AW.pop("", '<div class="finCard sdC">'+
    '<div class="fd"><span class="lbl">איפיון</span><b>'+E(r.typeId||"—")+'</b></div>'+
    '<div class="fd"><span class="lbl">תיאור</span><p class="tl">'+E(r.description||"—")+'</p></div>'+
    '<div class="fd"><span class="lbl">תאריך יעד</span><p class="num">'+E(r.dueAt?AW.fmt(r.dueAt):"—")+'</p></div>'+
    '<div class="sdActs">'+(ups.length?'<button class="eyeBtn" type="button" id="sdUps">'+AW.icon("M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7M3 4v4h4")+'<span>צפייה בעדכונים ('+ups.length+')</span></button>':'<span class="noUps">אין עדכונים</span>')+
      (files.length?'<button class="eyeBtn" type="button" id="sdFile">'+AW.icon("M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z")+'<span>צפייה בקובץ</span></button>':'')+'</div>'+
  '</div>', true);
  var u=box.querySelector("#sdUps");
  if(u) u.onclick=function(){
    AW.pop("עדכונים", '<div class="upList">'+ups.map(function(x){
      return '<div class="upRow"><span class="d num">'+E(x.date?AW.fmtShort(x.date):"")+'</span><span class="t">'+E(x.text)+'</span></div>';
    }).join("")+'</div>', true);
  };
  var fl=box.querySelector("#sdFile");
  if(fl) fl.onclick=function(){ AW.openFile(files[0]); };
};
// 07.11.26 — an icon for each category, all drawn alike: a navy line with the
// part that names it filled in. A box seen from the corner for the room
// trades — the ceiling, the floor or the walls of it darker.
AW.catIcon = function(key, label){
  var k=String(key||"").toLowerCase(), t=String(label||AW.CAT_HE[key]||"");
  var has=function(re){ return re.test(k)||re.test(t); };
  var BOX='<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="none"/>';
  var face={
    top:'<path d="M12 3l8 4.5-8 4.5-8-4.5z" class="f"/>',
    floor:'<path d="M4 16.5L12 12l8 4.5L12 21z" class="f"/>',
    walls:'<path d="M4 7.5L12 12v9l-8-4.5z" class="f"/><path d="M20 7.5L12 12v9l8-4.5z" class="f2"/>'
  };
  var cube=function(f){ return f+BOX+'<path d="M4 7.5L12 12l8-4.5M12 12v9"/>'; };
  var svg;
  if(has(/ceiling|תקר/)) svg=cube(face.top);
  else if(has(/floor|ריצוף|רצפ/)) svg=cube(face.floor);
  else if(has(/clad|גמר|חיפוי/)) svg=cube(face.walls);
  else if(has(/door|דלת|דלתות/)) svg='<path d="M6 21V4.5L14 3v18" class="f"/><path d="M4 21h16M14 5h4v16"/><circle cx="11.5" cy="12.5" r="1" fill="#fff" stroke="none"/>';
  else if(has(/curtain|וילו/)) svg='<path d="M3 4h18"/><path d="M5 4c0 6 2 11 4 16H5z" class="f"/><path d="M19 4c0 6-2 11-4 16h4z" class="f"/>';
  else if(has(/joiner|נגר|ריהוט|furn/)) svg='<rect x="4" y="5" width="16" height="11" rx="1.5" class="f"/><path d="M4 10.5h16M12 5v11M6 16v3M18 16v3"/>';
  else if(has(/construct|בינוי|build/)) svg='<path d="M14 4l6 6-3 3-6-6z" class="f"/><path d="M11.5 9.5L4 17l3 3 7.5-7.5"/>';
  else if(has(/light|תאור/)) svg='<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z" class="f"/>';
  else if(has(/electr|חשמל/)) svg='<path d="M13 2L5 13h6l-1 9 8-11h-6z" class="f"/>';
  else if(has(/hvac|מיזוג/)) svg='<rect x="3" y="5" width="18" height="8" rx="2" class="f"/><path d="M7 16l-1 3M12 16v3M17 16l1 3"/>';
  else if(has(/plumb|אינסטל/)) svg='<path d="M4 8h8a4 4 0 0 1 4 4v1h3v4h-3a4 4 0 0 1-4-4v-1H4z" class="f"/>';
  else if(has(/fire|אש/)) svg='<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 2 3 3 0-3 0-5 0-7z" class="f"/>';
  else if(has(/secur|ביטחון|av|מולטימדי/)) svg='<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" class="f"/>';
  else svg='<rect x="5" y="3" width="14" height="18" rx="2" class="f"/><path d="M8 8h8M8 12h8M8 16h5"/>';
  return '<svg viewBox="0 0 24 24" class="catSvg">'+svg+'</svg>';
};
// 06.11.26 — the subcontractor's checks: the check that is needed, and under
// it the date set for it. One marked done on the dashboard turns pale green.
AW.standardsSimple = function(list, withTrade){
  var E=AW.esc;
  list=(list||[]).slice();
  if(!list.length) return AW.empty("טרם הוגדרו בדיקות.");
  list.sort(function(a,c){
    var da=(a.date||"").slice(0,10), dc=(c.date||"").slice(0,10);
    if(!da&&!dc) return 0; if(!da) return 1; if(!dc) return -1; return da<dc?-1:da>dc?1:0;
  });
  return list.map(function(it){
    return '<div class="rec" style="padding:10px 12px'+(it.done?';background:#e0f2e6;border-color:#b6dfc3':'')+'">'+
      (withTrade&&it.trade?'<div style="font-size:11.5px;font-weight:800;color:#1d4f91;margin-bottom:3px">קבלן '+E(AW.tradeHe(it.trade))+'</div>':'')+
      '<div style="font-size:14px;font-weight:700;line-height:1.55;white-space:pre-wrap">'+E(it.text)+'</div>'+
      (it.date?'<div style="font-size:12px;color:var(--steel);margin-top:4px">תאריך לביצוע - <span class="num">'+E(AW.fmt(it.date))+'</span></div>':'')+
    '</div>';
  }).join("");
};
// 06.11.26 — "רשימת חומרי גמר": what the LLI shows to this kind of user.
// Free search, a table of type mark and picture; a row opens a card in the
// middle of the screen — category and type mark, the description, the
// picture, and a small close button back to the list.
AW.finishes = function(o){
  var E=AW.esc, items=o.items||[], needle=String(o.q||"").trim().toLowerCase();
  var shown=items.filter(function(r){
    return !needle || [r.category,r.typeMark,r.desc,r.code].join(" ").toLowerCase().indexOf(needle)>=0;
  });
  var h='<div class="find"><input id="fq" type="search" placeholder="חיפוש חופשי" value="'+E(o.q||"")+'"></div>';
  if(!items.length) return h+AW.empty("טרם נבחרו חומרי גמר להצגה.");
  if(!shown.length) return h+AW.empty("אין תוצאות לחיפוש.");
  h+='<table class="finTable"><thead><tr><th>איפיון</th><th>תמונה</th></tr></thead><tbody>'+
    shown.map(function(r){
      return '<tr data-fin="'+E(r.code)+'"><td><b>'+E(r.typeMark||"—")+'</b>'+(r.category?'<span>'+E(r.category)+'</span>':'')+'</td>'+
        '<td class="im">'+(r.image?'<img src="'+E(r.image)+'" alt="" loading="lazy">':'<span class="noIm">—</span>')+'</td></tr>';
    }).join("")+'</tbody></table>';
  return h;
};
// 07.11.26 — the list with its pictures comes with its own call, made when
// the list is opened (the pictures are large; the project opens faster
// without them).
AW.finishesScreen = function(fin){
  var S=AW.state, mark=(S.board&&S.board.marks||{}).finishes||"";
  if(!fin.loaded || fin.mark!==mark){
    AW.el().innerHTML=AW.head("רשימת חומרי גמר")+'<p class="lead">טוען את הרשימה…</p>';
    AW.wireBack();
    if(fin.loading) return;
    fin.loading=true;
    AW.call({action:"finishes", projectId:S.project, trade:(S.board&&S.board.trade)||""}).then(function(r){
      fin.loading=false; fin.loaded=true; fin.mark=mark;
      fin.items=r.ok ? (r.data.finishes||[]) : [];
      if(AW.view().v==="finishes") AW.render(true);
    }).catch(function(){ fin.loading=false; });
    return;
  }
  AW.el().innerHTML=AW.head("רשימת חומרי גמר")+AW.finishes(fin);
  AW.wireBack(); AW.wireFinishes(fin, function(){ AW.render(true); });
};
AW.wireFinishes = function(o, onChange){
  var E=AW.esc;
  var q=document.getElementById("fq");
  if(q) q.oninput=function(){ o.q=q.value; onChange(); var n=document.getElementById("fq"); if(n){ n.focus(); n.setSelectionRange(n.value.length,n.value.length); } };
  Array.prototype.forEach.call(document.querySelectorAll("tr[data-fin]"), function(tr){
    tr.onclick=function(){
      var code=tr.getAttribute("data-fin");
      var r=(o.items||[]).filter(function(x){ return x.code===code; })[0];
      if(!r) return;
      // 07.11.26 — category and type mark centred, titles and values; the
      // description as it was.
      AW.pop("", '<div class="finCard">'+
        '<div class="fr fc"><div><span class="lbl">קטגוריה</span><b>'+E(r.category||"—")+'</b></div>'+
          '<div><span class="lbl">איפיון</span><b>'+E(r.typeMark||"—")+'</b></div></div>'+
        '<div class="fd"><span class="lbl">תיאור</span><p>'+E(r.desc||"—")+'</p></div>'+
        (r.image?'<img class="fi" src="'+E(r.image)+'" alt="">':'')+
      '</div>', true);
    };
  });
};
AW.standards = function(list, withTrade){
  var E=AW.esc;
  list=(list||[]).slice();
  if(!list.length) return AW.empty("טרם נוספה בדיקה.");
  list.sort(function(a,c){
    var da=(a.date||"").slice(0,10), dc=(c.date||"").slice(0,10);
    if(!da&&!dc) return 0; if(!da) return 1; if(!dc) return -1; return da<dc?-1:da>dc?1:0;
  });
  var today=AW.todayIso();
  var eyeP="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6";
  var noteP="M4 4h11l5 5v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 12h7M8 16h5";
  return '<div class="checks">'+list.map(function(it,i){
    var late=!it.done&&it.date&&String(it.date).slice(0,10)<today, note=(it.note||"").trim();
    return '<div class="chk'+(it.done?" done":"")+(late?" late":"")+'">'+
      '<span class="box">'+(it.done?"✓":"")+'</span>'+
      '<span class="txt">'+E(it.text)+(it.date?'<span class="dt num">'+E(AW.fmt(it.date))+'</span>':'')+'</span>'+
      (withTrade&&it.trade?'<span class="trd">'+E(AW.tradeHe(it.trade))+'</span>':'')+
      (note?'<button class="ic note" data-n="'+i+'" title="הערות">'+AW.icon(noteP)+'</button>':'<span class="ic off">'+AW.icon(noteP)+'</span>')+
      (it.cert&&it.cert.url?'<a class="ic" href="'+E(it.cert.url)+'" target="_blank" rel="noopener" title="תעודה">'+AW.icon(eyeP)+'</a>'
        :'<span class="ic off">'+AW.icon(eyeP)+'</span>')+
      (note?'<div class="noteBox" id="nb'+i+'" hidden>'+E(note)+'</div>':'')+
    '</div>';
  }).join("")+'</div>';
};
AW.wireStandards = function(){
  Array.prototype.forEach.call(document.querySelectorAll(".chk .note"), function(b){
    b.onclick=function(){ var box=document.getElementById("nb"+b.getAttribute("data-n")); if(box) box.hidden=!box.hidden; };
  });
};
// The log of one trade: the table of earlier updates; a tap opens the update
// with its pictures.
AW.logTable = function(list){
  var E=AW.esc;
  list=(list||[]).slice().reverse();
  if(!list.length) return AW.empty("טרם נרשם עדכון.");
  return '<table class="tbl"><colgroup><col style="width:66px"><col style="width:34%"><col></colgroup>'+
    '<thead><tr><th>תאריך</th><th>נושא</th><th>תיאור</th></tr></thead><tbody>'+
    list.map(function(u,i){
      return '<tr class="click" data-u="'+i+'"><td class="num" style="font-size:11px">'+E(AW.fmtShort(u.date))+'</td>'+
        '<td style="text-align:right;font-weight:700">'+E(u.subject)+((u.files||[]).length?' 📷':'')+'</td>'+
        '<td style="text-align:right;color:#5b5e66">'+E(String(u.body||"").slice(0,70))+'</td></tr>';
    }).join("")+'</tbody></table>';
};
AW.wireLogTable = function(list){
  list=(list||[]).slice().reverse();
  Array.prototype.forEach.call(document.querySelectorAll("tr[data-u]"), function(tr){
    tr.onclick=function(){
      var u=list[Number(tr.getAttribute("data-u"))]; if(!u) return;
      AW.pop(AW.esc(u.subject), '<div class="lbl">'+AW.esc(AW.fmt(u.date))+(u.by?' · '+AW.esc(u.by):'')+'</div>'+
        (u.body?'<p style="white-space:pre-wrap;line-height:1.7;font-size:14px;margin:6px 0">'+AW.esc(u.body)+'</p>':'')+
        ((u.files||[]).length?AW.files(u.files):'<p class="lead" style="margin:10px 0 0">לא צורפו תמונות.</p>'));
    };
  });
};
