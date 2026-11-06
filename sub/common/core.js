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

  var state = { token:null, projects:[], project:null, board:null };

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
  var PV_READ={projects:1,board:1,tasks:1,vapid:1,lists:1,list:1};
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
  function call(body){ body.token=body.token||state.token; return post(API, body); }
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
  function openDoc(url){
    busy("טוען את המסמך…");
    history.pushState({doc:1},"");
    fetch(url).then(function(r){ return r.text(); }).then(function(html){
      var css='<style>@media screen{html,body{background:#fff!important;padding:0!important;margin:0!important}'+
        '.page{width:100%!important;height:auto!important;min-height:0!important;padding:8px!important;margin:0 0 10px!important;box-shadow:none!important}'+
        '.sheet{height:auto!important}.frame{height:auto!important}}</style>';
      el().innerHTML='<button class="backArrow" id="docBack" aria-label="חזרה">'+icon("M15 6l-6 6 6 6")+'</button>'+
        '<iframe class="docFrame" srcdoc="'+esc(String(html||"").replace(/<\/head>/i, css+'</head>'))+'"></iframe>';
      document.getElementById("docBack").onclick=function(){ history.back(); };
    }).catch(function(){ alert("לא ניתן לפתוח את המסמך."); history.back(); });
  }
  function openFile(f){ if(!f||!f.url) return; if(isDoc(f)) openDoc(f.url); else window.open(f.url,"_blank","noopener"); }
  // A small window from the bottom of the screen.
  function pop(title, html){
    var box=document.createElement("div");
    box.className="pop";
    box.innerHTML='<div class="popCard">'+(title?'<h3>'+title+'</h3>':'')+html+'<button class="x" type="button">סגירה</button></div>';
    document.body.appendChild(box);
    var close=function(){ box.remove(); };
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
      return '<tr class="'+(d.iso===today?"today":"")+'"><th>'+d.name+'<span class="num">'+esc(fmt(d.iso).slice(0,5))+'</span></th>'+
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
    '</div>';
  }

  // ------------------------------------------------------------- navigation
  // Every screen is a step pushed on the browser's history, so the phone's own
  // back gesture and the "חזרה" on screen do the same thing.
  var stack=[], renderFn=null;
  function view(){ return stack.length ? stack[stack.length-1] : {v:"home"}; }
  function go(v){ stack.push(v); history.pushState({aw:stack.length},""); render(); }
  function replace(v){ if(stack.length) stack[stack.length-1]=v; else stack.push(v); render(); }
  function render(keepScroll){
    var y=window.scrollY;
    if(renderFn) renderFn(view());
    window.scrollTo(0, keepScroll?y:0);
  }
  window.addEventListener("popstate", function(){
    if(document.querySelector(".pop")){ document.querySelector(".pop").remove(); }
    if(stack.length){ stack.pop(); render(); return; }
    // Out of the app: back to the projects.
    toEntry();
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
    if(PREVIEW){ document.body.classList.add("isPv"); if(out) out.hidden=true; }
    else if(out){ out.hidden=false; out.onclick=function(){ signOut(); }; }
    state.project=q.get("p")||"";
    state.token=PREVIEW ? "preview" : (function(){ try{ return localStorage.getItem(TOKEN_KEY); }catch(e){ return null; } })();
    try{ state.projects=JSON.parse(localStorage.getItem(TOKEN_KEY+".projects")||"[]"); }catch(e){ state.projects=[]; }
    if(!state.token || !state.project){ toEntry(); return; }
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
    if(q.get("trade")) body.trade=q.get("trade");
    return call(body).then(function(r){
      if(r.ok){
        var first=!state.board;
        state.board=r.data;
        if(first){
          var fk="awsub.first|"+state.project+"|"+(state.board.trade||"");
          try{ if(localStorage.getItem(fk)!=="1"){ markAllSeen(); localStorage.setItem(fk,"1"); } }catch(e){}
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
    isNew:isNew, markSeen:markSeen, projHead:projHead,
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
AW.itemList = function(o){
  // o: { items, kind: "submittal"|"sd", key (state holder) }
  var E=AW.esc, f=o.filter||{}, items=o.items||[];
  var catName=function(c){ return AW.CAT_HE[c]||c||"ללא קטגוריה"; };
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
    '<div class="two"><select id="fc"><option value="">כל הקטגוריות</option>'+cats.map(function(c){
      return '<option value="'+E(c)+'"'+(f.cat===c?" selected":"")+'>'+E(catName(c))+'</option>'; }).join("")+'</select>'+
    '<select id="ft"><option value="">כל האיפיונים</option>'+types.map(function(t){
      return '<option value="'+E(t)+'"'+(f.type===t?" selected":"")+'>'+E(t)+'</option>'; }).join("")+'</select></div></div>';
  if(!shown.length) h+=AW.empty(items.length?"אין תוצאות לחיפוש.":"אין פריטים להצגה.");
  shown.forEach(function(r){
    var id=r.id||r.code, st=stOf(r), open=f.open===id;
    var tn=o.simple?tone(r):null;
    h+='<button class="item" data-id="'+E(id)+'"'+(tn?' style="background:'+tn.bg+';border-color:'+tn.bd+'"':'')+'>'+
      (r.image?'<img class="pic" src="'+E(r.image)+'" alt="">':(o.simple?'':'<span class="pic"></span>'))+
      '<span class="tx"><b>'+E(r.typeId||r.no||r.code||"—")+'</b><span>'+E(catName(r.category))+'</span></span>'+
      '<span class="st" style="color:'+st.c+';background:'+st.bg+'">'+E(st.t)+'</span></button>';
    if(open){
      var doc=r.doc || ((r.files||[]).filter(AW.isDoc)[0]) || null;
      var others=(r.files||[]).filter(function(x){ return !AW.isDoc(x); });
      h+='<div class="itemOpen">'+(r.no?'<div class="lbl">'+E(r.no)+'</div>':'')+
        '<p>'+E(r.description||"—")+'</p>'+
        (doc?'<div class="acts"><button class="pill" type="button" data-doc="'+E(id)+'">'+(o.kind==="sd"?"צפייה בקובץ":"צפייה בסבמיטל")+'</button></div>':'')+
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
    b.onclick=function(){ var id=b.getAttribute("data-id"); f.open=f.open===id?null:id; onChange(true); };
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
// 06.11.26 — the subcontractor's checks: the check that is needed, and under
// it the date set for it. One marked done on the dashboard turns pale green.
AW.standardsSimple = function(list){
  var E=AW.esc;
  list=(list||[]).slice();
  if(!list.length) return AW.empty("טרם הוגדרו בדיקות.");
  list.sort(function(a,c){
    var da=(a.date||"").slice(0,10), dc=(c.date||"").slice(0,10);
    if(!da&&!dc) return 0; if(!da) return 1; if(!dc) return -1; return da<dc?-1:da>dc?1:0;
  });
  return list.map(function(it){
    return '<div class="rec" style="padding:10px 12px'+(it.done?';background:#e0f2e6;border-color:#b6dfc3':'')+'">'+
      '<div style="font-size:14px;font-weight:700;line-height:1.55;white-space:pre-wrap">'+E(it.text)+'</div>'+
      (it.date?'<div style="font-size:12px;color:var(--steel);margin-top:4px">תאריך לביצוע - <span class="num">'+E(AW.fmt(it.date))+'</span></div>':'')+
    '</div>';
  }).join("");
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
