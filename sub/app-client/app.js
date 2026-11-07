// ---------------------------------------------------------------------------
// The client's and the supervision's app (06.11.26). One screen for both:
// the project, then רשימת חומרי גמר (what the LLI shows them).
// ---------------------------------------------------------------------------
(function(){
var E=AW.esc, S=AW.state;
var IC={ finishes:"M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4" };
var fin={q:""};
function longBtn(k, title){
  return '<button class="longBtn" data-k="'+k+'"><span class="ico">'+AW.icon(IC[k])+'</span><span class="t">'+E(title)+'</span>'+(AW.isNew(k)?'<span class="newStar">★ עדכון חדש</span>':'')+'</button>';
}
function home(){
  var role=S.board&&S.board.role, app=AW.el();
  app.innerHTML=((S.projects||[]).length>1||AW.PREVIEW?'<button class="backArrow" id="toProj" aria-label="פרויקטים">'+AW.icon("M15 6l-6 6 6 6")+'</button>':'')+
    AW.projHead(AW.PREVIEW ? "פיקוח, לקוח ואדריכלים" : (AW.ROLE_HE[role]||""))+
    longBtn("finishes","רשימת חומרי גמר");
  var tp=document.getElementById("toProj"); if(tp) tp.onclick=AW.toEntry;
  Array.prototype.forEach.call(app.querySelectorAll(".longBtn[data-k]"), function(el){
    el.onclick=function(){ var k=el.getAttribute("data-k"); AW.markSeen(k); AW.go({v:k}); };
  });
}
function finishes(){ AW.finishesScreen(fin); }
AW.boot({ render:function(v){
  if(!S.board) return;
  if(v && v.v==="finishes") return finishes();
  home();
}});
})();
