// ---------------------------------------------------------------------------
// ריג'קטים — shared by the project manager's app and the subcontractor's
// (06.11.26). A project manager sees every list of the project, opens new ones
// (for a trade, or an internal list), adds and edits rows, and marks a row
// "טופל" — a second press takes the mark off. A subcontractor sees the lists
// made for his trade and only reads them. A row that was dealt with is green,
// here and on the dashboard. sub-rejects decides all of it again.
// ---------------------------------------------------------------------------
AW.rejects = (function(){
  var E=AW.esc;
  var draft=null;
  var R={ lists:null, list:null, isPm:false };

  function loadLists(then){
    AW.busy("טוען רשימות…");
    AW.rjCall({action:"lists"}).then(function(r){
      if(!r.ok){ AW.retry("טעינת הרשימות נכשלה.", function(){ loadLists(then); }); return; }
      R.lists=r.data.lists||[]; R.isPm=!!r.data.isPm;
      if(then) then(); else AW.render();
    }).catch(function(){ AW.retry("אין חיבור לרשת.", function(){ loadLists(then); }); });
  }
  function loadList(id, quiet){
    if(!quiet) AW.busy("טוען את הרשימה…");
    return AW.rjCall({action:"list", listId:id}).then(function(r){
      if(!r.ok){ AW.retry("טעינת הרשימה נכשלה.", function(){ loadList(id); }); return; }
      R.list=r.data.list; R.isPm=!!r.data.isPm;
      AW.render(!!quiet);
    }).catch(function(){ AW.retry("אין חיבור לרשת.", function(){ loadList(id); }); });
  }
  // How many lists this user may open — for the button on the home screen.
  function count(then){
    AW.rjCall({action:"lists"}).then(function(r){ if(r.ok) then((r.data.lists||[]).length, !!r.data.isPm); }).catch(function(){});
  }
  function shots(arr){
    if(!arr||!arr.length) return "";
    return '<div class="files">'+arr.map(function(p){
      return p.url ? '<a class="file img" href="'+E(p.url)+'" target="_blank" rel="noopener"><img src="'+E(p.thumb)+'" alt=""></a>'
                   : '<span class="file img"><img src="'+E(p.thumb)+'" alt=""></span>';
    }).join("")+'</div>';
  }

  // v: { v:"rj" } lists · { v:"rj", list:id } one list · { v:"rj", list:id, row:id|null, edit:bool }
  function draw(v){
    var app=AW.el();
    if(!v.list){
      if(!R.lists){ loadLists(); return; }
      var add="";
      if(R.isPm){
        if(draft&&draft.newList){
          add='<div class="form"><input id="rjName" placeholder="שם הרשימה" value="'+E(draft.name||"")+'">'+
            '<input id="rjDate" type="date" value="'+E(draft.date||AW.todayIso())+'">'+
            '<input id="rjAtt" placeholder="נוכחים בסיור" value="'+E(draft.att||"")+'">'+
            '<div class="lbl" style="text-align:right">סוג קבלן</div><div class="chips" style="flex-wrap:wrap">'+
              '<button type="button" class="chip'+(!(draft.trades||[]).length?" on":"")+'" data-tr="">ללא קבלן — פנימית</button>'+
              AW.TRADES.map(function(t){ return '<button type="button" class="chip'+((draft.trades||[]).indexOf(t.k)>=0?" on":"")+'" data-tr="'+t.k+'">'+E(t.t)+'</button>'; }).join("")+
            '</div><div class="row"><button id="rjMk">יצירה</button><button id="rjNo" class="ghost">ביטול</button></div></div>';
        } else add='<div class="writeBar"><button id="rjNew">+ רשימה חדשה</button></div>';
      }
      app.innerHTML=AW.head("ריג'קטים")+add+(R.lists.length ? R.lists.map(function(l){
        return '<button class="rjRow'+(l.count&&l.done===l.count?" ok":"")+'" data-l="'+E(l.id)+'"><b>'+E(l.name||"ללא שם")+'</b>'+
          '<div class="meta">'+[l.list_date?'<span class="num">'+E(AW.fmt(l.list_date))+'</span>':"",
            (l.trades||[]).length?E(l.trades.map(AW.tradeHe).join(", ")):(R.isPm?"פנימית":""),
            l.done+'/'+l.count+' טופלו'].filter(Boolean).join(" · ")+'</div></button>';
      }).join("") : AW.empty("אין רשימות."));
      AW.wireBack();
      Array.prototype.forEach.call(app.querySelectorAll("[data-l]"), function(b){
        b.onclick=function(){ R.list=null; AW.go({v:"rj", list:b.getAttribute("data-l")}); };
      });
      var keepNew=function(){
        draft.name=document.getElementById("rjName").value; draft.date=document.getElementById("rjDate").value;
        draft.att=document.getElementById("rjAtt").value;
      };
      var nw=document.getElementById("rjNew"); if(nw) nw.onclick=function(){ draft={newList:true,trades:[]}; AW.render(true); };
      var no=document.getElementById("rjNo"); if(no) no.onclick=function(){ draft=null; AW.render(true); };
      Array.prototype.forEach.call(app.querySelectorAll("[data-tr]"), function(b){
        b.onclick=function(){
          keepNew();
          var k=b.getAttribute("data-tr");
          if(!k) draft.trades=[];
          else draft.trades=draft.trades.indexOf(k)>=0?draft.trades.filter(function(x){return x!==k;}):draft.trades.concat([k]);
          AW.render(true);
        };
      });
      var mk=document.getElementById("rjMk");
      if(mk) mk.onclick=function(){
        keepNew();
        if(!String(draft.name||"").trim()){ alert("צריך שם לרשימה."); return; }
        mk.disabled=true; mk.textContent="שומר…";
        AW.rjCall({action:"new-list", name:draft.name.trim(), list_date:draft.date, attendees:draft.att, trades:draft.trades||[]})
          .then(function(r){
            draft=null; R.lists=null;
            if(!r.ok||!r.data.id){ if(!r.data||!r.data.preview) alert("היצירה נכשלה."); AW.render(); return; }
            R.list=null; AW.replace({v:"rj"}); AW.go({v:"rj", list:r.data.id});
          }).catch(function(){ mk.disabled=false; mk.textContent="יצירה"; alert("אין חיבור."); });
      };
      return;
    }
    if(!R.list || R.list.id!==v.list){ loadList(v.list); return; }
    var l=R.list;
    if(v.row===undefined){
      var info=[l.list_date?'<span class="num">'+E(AW.fmt(l.list_date))+'</span>':"", l.attendees?"נוכחים: "+E(l.attendees):""].filter(Boolean).join(" · ");
      app.innerHTML=AW.head(E(l.name||"ללא שם"))+(info?'<p class="rjInfo">'+info+'</p>':'')+
        (R.isPm?'<div class="writeBar"><button id="rjAdd">+ שורה</button></div>':'')+
        (l.rows.length ? l.rows.map(function(r,i){
          return '<button class="rjRow'+(r.done?" ok":"")+'" data-r="'+E(r.id)+'"><span class="n">'+(i+1)+'</span>'+
            (r.floor?'<b>קומה '+E(r.floor)+'</b> · ':'')+E((r.desc||"").slice(0,90))+
            '<div class="meta">'+[r.owner?E(r.owner):"", r.due?'<span class="num">'+E(AW.fmt(r.due))+'</span>':"",
              r.photos.length?r.photos.length+" תמונות":""].filter(Boolean).join(" · ")+'</div></button>';
        }).join("") : AW.empty("אין שורות ברשימה."));
      AW.wireBack();
      Array.prototype.forEach.call(app.querySelectorAll("[data-r]"), function(b){
        b.onclick=function(){ AW.go({v:"rj", list:l.id, row:b.getAttribute("data-r"), edit:false}); };
      });
      var ad=document.getElementById("rjAdd");
      if(ad) ad.onclick=function(){ draft={row:{floor:"",desc:"",owner:"",due:""},photos:[],note:""}; AW.go({v:"rj", list:l.id, row:null, edit:true}); };
      return;
    }
    var idx=-1, row=null;
    l.rows.forEach(function(r,i){ if(r.id===v.row){ row=r; idx=i; } });
    if(v.edit){
      var d=draft||{row:{},photos:[],note:""};
      var val=function(k){ return E(d.row[k]!=null?d.row[k]:(row?row[k]:"")); };
      app.innerHTML=AW.head(row?'שורה '+(idx+1):'שורה חדשה')+'<div class="form">'+
        '<div class="rjField">קומה</div><input id="rjF" value="'+val("floor")+'">'+
        '<div class="rjField">תיאור</div><textarea id="rjT">'+val("desc")+'</textarea>'+
        '<div class="rjField">אחריות</div><input id="rjO" value="'+val("owner")+'">'+
        '<div class="rjField">מועד לביצוע</div><input id="rjU" type="date" value="'+val("due")+'">'+
        '<div class="rjField c">תמונות</div><div class="shots">'+
          (row?row.photos:[]).map(function(p){ return '<img src="'+E(p.thumb)+'" alt="">'; }).join("")+
          d.photos.map(function(p){ return '<img src="'+p.thumb+'" alt="">'; }).join("")+
          '<label title="צילום">📷<input id="rjCam" type="file" accept="image/*" capture="environment" style="display:none"></label>'+
          '<label title="מהגלריה">+<input id="rjGal" type="file" accept="image/*" multiple style="display:none"></label></div>'+
        (row&&row.notes.length?'<div class="rjField">הערות</div>'+row.notes.map(function(n){ return '<div class="rjNote"><b>'+E(AW.fmt(n.at))+'</b>'+E(n.text)+'</div>'; }).join(""):"")+
        '<textarea id="rjN" placeholder="הערה חדשה (תישמר עם התאריך של היום)" style="min-height:64px">'+E(d.note||"")+'</textarea>'+
        '<div class="row"><button id="rjS">שמירה</button><button id="rjC" class="ghost">ביטול</button></div></div>';
      var keep=function(){
        d.row.floor=document.getElementById("rjF").value; d.row.desc=document.getElementById("rjT").value;
        d.row.owner=document.getElementById("rjO").value; d.row.due=document.getElementById("rjU").value;
        d.note=document.getElementById("rjN").value; draft=d;
      };
      var addFiles=function(fl){
        keep();
        var arr=Array.prototype.slice.call(fl||[]);
        Promise.all(arr.map(function(f){ return Promise.all([AW.shrink(f), AW.thumb(f)]); })).then(function(got){
          got.forEach(function(g){ if(g[0]) d.photos.push({data:g[0].data, thumb:g[1]}); });
          draft=d; AW.render(true);
        });
      };
      document.getElementById("rjCam").onchange=function(e){ addFiles(e.target.files); };
      document.getElementById("rjGal").onchange=function(e){ addFiles(e.target.files); };
      AW.wireBack();
      document.getElementById("rjC").onclick=function(){ draft=null; history.back(); };
      document.getElementById("rjS").onclick=function(){
        keep();
        var btn=document.getElementById("rjS"); btn.disabled=true; btn.textContent="שומר…";
        var r=d.row; if(row) r.id=row.id;
        AW.rjCall({action:"save-row", listId:l.id, row:r, photos:d.photos, note:d.note}).then(function(res){
          if(!res.ok){ btn.disabled=false; btn.textContent="שמירה"; alert(res.status===409?"מישהו אחר שמר בדיוק עכשיו. נסו שוב.":"השמירה נכשלה."); return; }
          draft=null;
          history.back();
          setTimeout(function(){ loadList(l.id, true); }, 50);
        }).catch(function(){ btn.disabled=false; btn.textContent="שמירה"; alert("אין חיבור."); });
      };
      return;
    }
    if(!row){ history.back(); return; }
    app.innerHTML=AW.head('שורה '+(idx+1))+
      '<article class="rec"'+(row.done?' style="background:#e3f3e6;border-color:#9fd3ae"':'')+'>'+
      (row.floor?'<div class="rjField">קומה</div><div class="rjVal">'+E(row.floor)+'</div>':'')+
      (row.desc?'<div class="rjField">תיאור</div><div class="rjVal">'+E(row.desc)+'</div>':'')+
      (row.owner?'<div class="rjField">אחריות</div><div class="rjVal">'+E(row.owner)+'</div>':'')+
      (row.due?'<div class="rjField">מועד לביצוע</div><div class="rjVal num" style="text-align:right">'+E(AW.fmt(row.due))+'</div>':'')+
      (row.photos.length?'<div class="rjField c">תמונות</div>'+shots(row.photos):'')+
      (row.plans.length?'<div class="rjField c">תוכנית</div>'+shots(row.plans):'')+
      (row.notes.length?'<div class="rjField">הערות</div>'+row.notes.map(function(n){ return '<div class="rjNote"><b>'+E(AW.fmt(n.at))+'</b>'+E(n.text)+'</div>'; }).join(""):'')+
      '</article>'+
      (R.isPm?'<div class="rjActs"><button id="rjE" type="button">עריכה</button>'+
        '<button id="rjDone" type="button" class="'+(row.done?"done":"")+'">'+(row.done?"טופל ✓":"טופל")+'</button></div>':'');
    AW.wireBack();
    var ed=document.getElementById("rjE");
    if(ed) ed.onclick=function(){ draft={row:{},photos:[],note:""}; AW.go({v:"rj", list:l.id, row:row.id, edit:true}); };
    var dn=document.getElementById("rjDone");
    if(dn) dn.onclick=function(){
      dn.disabled=true;
      AW.rjCall({action:"save-row", listId:l.id, row:{id:row.id, done:!row.done}}).then(function(res){
        dn.disabled=false;
        if(!res.ok){ alert("השמירה נכשלה."); return; }
        if(res.data&&res.data.preview) return;
        loadList(l.id, true);
      }).catch(function(){ dn.disabled=false; alert("אין חיבור."); });
    };
  }
  return { draw:draw, count:count, reset:function(){ R.lists=null; R.list=null; draft=null; }, busy:function(){ return !!draft; } };
})();
