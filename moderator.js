/* Challenger Rips moderator-only test GP panel.
   Authorization and balances are server owned. This script only renders data. */
(()=>{
'use strict';
const gp=n=>Number(n||0).toLocaleString('en-US')+' GP';
const valid=n=>Number.isSafeInteger(Number(n))&&Number(n)>=0;
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'
}[x]));
function render(status,state){
 if(!status?.isModerator||!status.canAddGp)return '';
 const max=Number(status.maxPerGrant||1000000000);
 const history=Array.isArray(status.history)?status.history:[];
 return '<div class="mod-dashboard">'+
   '<div class="mod-hero"><span class="mod-kicker">CHALLENGER RIPS · STAFF TOOLS</span>'+
   '<div class="mod-hero-heading"><div><h2>Moderator Console</h2>'+
   '<p>Test pack purchases and gameplay using GP added to your own account.</p></div>'+
   '<span class="mod-role-label">MODERATOR</span></div></div>'+
   '<div class="mod-layout"><section class="mod-balance-card" aria-label="Your GP balance">'+
   '<span class="mod-label">Your current GP</span>'+
   '<strong class="mod-current-gp">'+gp(state?.gp)+'</strong>'+
   '<small>Account: '+esc(state?.name||'Your account')+'</small>'+
   '</section>'+
   '<section class="mod-add-card" aria-label="Add testing GP">'+
   '<h3>Add Testing GP</h3><p>Choose an amount to add to your balance. Only your account can receive these GP.</p>'+
   '<div class="mod-shortcuts" role="group" aria-label="Suggested GP amounts">'+
   [100000,1000000,10000000,100000000].map(n=>
     '<button type="button" class="quiet" data-act="mod-preset" data-id="'+n+'">+'+(n>=1000000?n/1000000+'M':n/1000+'K')+'</button>').join('')+'</div>'+
   '<label for="mod-gp-amount">Custom GP amount</label>'+
   '<div class="mod-amount-row"><input id="mod-gp-amount" type="number" inputmode="numeric" '+
   'min="1" max="'+max+'" step="1" placeholder="Enter amount" autocomplete="off" />'+
   '<button type="button" class="primary" data-act="mod-gp-add">Add GP</button></div>'+
   '<small class="mod-limit">1 to '+gp(max)+' per adjustment. Changes to this live GP wallet are permanent until spent.</small>'+
   '</section></div>'+
   '<section class="mod-history" aria-label="Moderator GP adjustment history">'+
   '<div class="mod-history-heading"><h3>Recent adjustments</h3><span>Audited in Supabase</span></div>'+
   (history.length?'<div class="mod-history-list">'+history.map(record=>{
     const amount=valid(record.amount)?gp(record.amount):'—';
     const after=valid(record.balanceAfter)?gp(record.balanceAfter):'—';
     const date=record.createdAt?new Date(record.createdAt):null;
     const when=date&&Number.isFinite(date.getTime())?
       date.toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):
       'Recorded';
     return '<div class="mod-history-row"><div><strong>+'+amount+'</strong>'+
       '<span>'+esc(when)+'</span></div><small>Balance after: '+after+'</small></div>';
   }).join('')+'</div>':
   '<p class="mod-empty-history">No moderator GP adjustments yet.</p>')+
   '</section><p class="mod-safety-note">These are real GP in the Challenger Rips test economy, not redeemable currency. This panel is hidden from regular players, and all grants require server-side moderator authorization.</p>'+
   '</div>';
}
window.ChallengerModerator={render};
})();