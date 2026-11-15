/* Challenger Rips: earned GP presentation.
   All rewards, unlocks, and cooldowns come from the authenticated Supabase response. */
(()=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=n=>(Number(n)||0).toLocaleString('en-US')+' GP';
  function render(board,state,packs,error=false){
    const head='<div class="earn-heading"><div><span class="earn-eyebrow">PLAYER REWARDS</span>'+
      '<h2>Earn GP</h2></div><strong>'+money(state?.gp)+'</strong></div>';
    if(!board)return '<div class="earn-dashboard">'+head+
      (error?'<p class="earn-empty">Rewards are unavailable right now.</p><button type="button" class="quiet" data-act="earn-refresh">Try again</button>':
        '<p class="earn-empty" role="status">Loading your rewards…</p>')+'</div>';
    const dailyAvailable=state?.daily===true ||
      (!state?.nextDailyAt&&Boolean(state));
    const recovery=board.recovery||{};
    const canRecover=Boolean(recovery.available);
    const source=Array.isArray(board.milestones)?board.milestones:[];
    const packNames=new Map((packs||[]).map(p=>[p.id,p.name]));
    const row=m=>{
      const claimed=Boolean(m.claimed),ready=Boolean(m.available);
      const label=claimed?'Claimed':ready?'Claim':'Locked';
      return '<div class="earn-milestone'+(ready?' is-ready':'')+'">'+
        '<span class="earn-milestone-info"><strong>'+esc(m.title)+'</strong>'+
        '<small>'+Number(m.found).toLocaleString()+' / '+Number(m.goal).toLocaleString()+' items</small></span>'+
        '<span class="earn-milestone-prize">'+money(m.amount)+'</span>'+
        '<button type="button" class="'+(ready?'primary':'quiet')+'" data-act="earn-milestone" data-id="'+esc(m.code)+'"'+
        (ready?'':' disabled')+'>'+label+'</button></div>';
    };
    const categories=[...new Set(source.map(m=>m.pack))];
    const milestones=categories.map(pack=>{
      const items=source.filter(m=>m.pack===pack);
      const done=items.filter(m=>m.claimed).length;
      return '<div class="earn-group"><div class="earn-group-heading"><h4>'+esc(packNames.get(pack)||pack)+'</h4>'+
        '<span>'+done+' / '+items.length+' claimed</span></div>'+
        items.map(row).join('')+'</div>';
    }).join('');
    const summary=source.filter(m=>m.available).length;
    return '<div class="earn-dashboard">'+head+
      '<div class="earn-quick-grid">'+
      '<article class="earn-quick"><span class="earn-quick-title">Daily GP</span><strong>'+money(board.dailyAmount)+'</strong>'+
      '<button type="button" class="primary" data-act="earn-daily"'+(dailyAvailable?'':' disabled')+'>'+
      (dailyAvailable?'Claim GP':'Claimed today')+'</button></article>'+
      '<article class="earn-quick"><span class="earn-quick-title">Low-balance recovery</span><strong>'+money(recovery.amount)+'</strong>'+
      '<button type="button" class="primary" data-act="earn-recover"'+(canRecover?'':' disabled')+'>'+
      (canRecover?'Claim recovery':recovery.pendingPack?'Finish current pack':recovery.balanceTooHigh?'Not needed':'On cooldown')+'</button>'+
      '<small>Available below '+money(board.minimumPackPrice)+' · once every 24 hours</small></article></div>'+
      '<div class="earn-section-heading"><h3>Collection milestones</h3><span>'+summary+' ready to claim</span></div>'+
      '<div class="earn-groups">'+milestones+'</div></div>';
  }
  window.ChallengerEconomy={render};
})();