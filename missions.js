/* Challenger Rips: Mission presentation only.
   Counts, eligibility and rewards come entirely from the authenticated server. */
(()=>{
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const gp=value=>Number(value||0).toLocaleString('en-US')+' GP';
const icon=metric=>({packs:'◈',discovery:'✧',sales:'✦'}[metric]||'◆');
const clock=seconds=>{
 const h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;
 return [h,m,s].map(n=>String(n).padStart(2,'0')).join(':');
};
function card(m){
 const progress=Math.min(Math.max(0,Number(m.progress)||0),Number(m.goal)||1);
 const goal=Math.max(1,Number(m.goal)||1);
 const pct=Math.round(100*progress/goal);
 const claimed=Boolean(m.claimed);
 const ready=Boolean(m.available)&&!claimed;
 const caption=claimed?'Reward claimed':ready?'Mission complete':'Keep playing to unlock';
 return '<article class="mission-card'+(ready?' is-ready':'')+(claimed?' is-claimed':'')+'">'+
  '<div class="mission-top"><span class="mission-symbol" aria-hidden="true">'+icon(m.metric)+'</span>'+
  '<div class="mission-text"><h4>'+esc(m.title)+'</h4><p>'+esc(m.description)+'</p></div>'+
  '<span class="mission-reward">+'+gp(m.reward)+'</span></div>'+
  '<div class="mission-progress-head"><span>'+progress+' / '+goal+'</span><small>'+caption+'</small></div>'+
  '<div class="mission-track" role="progressbar" aria-label="'+esc(m.title)+' progress" aria-valuemin="0" aria-valuemax="'+goal+'" aria-valuenow="'+progress+'">'+
  '<div class="mission-fill" style="width:'+pct+'%"></div></div>'+
  '<button type="button" class="'+(ready?'primary':'quiet')+' mission-claim-button" data-act="mission-claim" data-id="'+esc(m.id)+'"'+
   (!ready?' disabled':'')+'>'+(claimed?'✓ Claimed':ready?'Claim '+gp(m.reward):'In progress')+'</button>'+
 '</article>';
}
function group(title,subtitle,kind,data,resetAt){
 const completed=data.filter(m=>m.claimed).length;
 const ready=data.filter(m=>m.available&&!m.claimed).length;
 return '<section class="mission-group" aria-label="'+title+'">'+
  '<div class="mission-group-head"><div><span class="mission-group-kicker">'+esc(subtitle)+'</span>'+
  '<h3>'+title+'</h3><p>'+completed+' / '+data.length+' rewards claimed'+(ready?' · '+ready+' ready':'')+'</p></div>'+
  '<div class="mission-timer"><small>Resets in</small><strong data-mission-reset="'+kind+'" role="timer" aria-live="off">--:--:--</strong></div></div>'+
  '<div class="mission-cards">'+data.map(card).join('')+'</div></section>';
}
function render(board,error=false){
 if(!board){
  return '<div class="mission-page"><div class="mission-hero">'+
   '<span class="mission-eyebrow">CHALLENGER RIPS · MISSIONS</span><h2>Your next challenge awaits</h2>'+
   '<p>Play, collect and earn bonus GP for completing objectives.</p></div>'+
   '<div class="mission-loading" role="status">'+(error?
   'Missions are unavailable right now. <button type="button" class="quiet" data-act="mission-refresh">Try again</button>':
   'Loading daily and weekly missions…')+'</div></div>';
 }
 const daily=Array.isArray(board.daily)?board.daily:[];
 const weekly=Array.isArray(board.weekly)?board.weekly:[];
 const count=[...daily,...weekly].filter(m=>m.available&&!m.claimed).length;
 return '<div class="mission-page"><div class="mission-hero">'+
   '<span class="mission-eyebrow">CHALLENGER RIPS · MISSIONS</span>'+
   '<h2>Earn GP. Complete quests.</h2>'+
   '<p>Your progress updates automatically from real pack openings, first-time discoveries and completed item sales.</p>'+
   '<div class="mission-hero-footer"><span>'+count+' '+(count===1?'reward':'rewards')+' ready to claim</span>'+
   '<button class="quiet" type="button" data-act="mission-refresh">↻ Refresh progress</button></div></div>'+
   '<div class="mission-columns">'+
   group('Daily Missions','EVERY DAY','daily',daily,board.dailyResetAt)+
   group('Weekly Missions','EVERY WEEK','weekly',weekly,board.weeklyResetAt)+
   '</div><p class="mission-footnote">Missions reset at 00:00 UTC daily and Monday 00:00 UTC weekly. Only newly sold items count toward sale missions. First-time discoveries count once per item, and every mission reward can be claimed once per period.</p></div>';
}
function tick(root,board,offset=0){
 if(!root||!board)return;
 const now=Date.now()+(Number(offset)||0);
 for(const kind of ['daily','weekly']){
  const end=Date.parse(board[kind+'ResetAt']);
  const rem=Number.isFinite(end)?Math.max(0,Math.ceil((end-now)/1000)):0;
  const element=root.querySelector('[data-mission-reset="'+kind+'"]');
  if(element)element.textContent=clock(rem);
 }
}
window.ChallengerMissions={render,tick};
})();