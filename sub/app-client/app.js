// ---------------------------------------------------------------------------
// The client's and the supervision's app (06.11.26). One screen for both;
// what it shows is to be decided with Marcella. For now: the project, as on
// every app's opening screen.
// ---------------------------------------------------------------------------
(function(){
var S=AW.state;
function home(){
  var role=S.board&&S.board.role;
  AW.el().innerHTML=((S.projects||[]).length>1||AW.PREVIEW?'<button class="backArrow" id="toProj" aria-label="פרויקטים">'+AW.icon("M15 6l-6 6 6 6")+'</button>':'')+
    AW.projHead(AW.ROLE_HE[role]||"")+
    AW.empty("המסך של לקוח ופיקוח ייבנה בשלב הבא.");
  var tp=document.getElementById("toProj"); if(tp) tp.onclick=AW.toEntry;
}
AW.boot({ render:function(){ if(S.board) home(); } });
})();
