/* Challenger Rips Earn GP.
   All claim eligibility, progression and GP amounts are authenticated Supabase data.
   Timers are presentational: the server remains authoritative. */
(()=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
  const money=n=>(Number(n)||0).toLocaleString('en-US')+' GP';

  const secondsRemaining=(date,offset=0,now=Date.now())=>{
    if(!date)return 0;
    const end=Date.parse(date);
    return Number.isFinite(end)?Math.max(0,Math.ceil((end-(now+(Number(offset)||0)))/1000)):0;
  };
  const clock=seconds=>{
    const hrs=Math.floor(seconds/3600), mins=Math.floor(seconds%3600/60), secs=seconds%60;
    return [hrs,mins,secs].map(x=>String(x).padStart(2,'0')).join(':');
  };
  function cards(board,state){
    const rec=board.recovery||{};
    return '<div class="earn-quick-grid">'+
      '<article class="earn-quick" aria-label="Daily GP claim">'+
        '<div class="earn-quick-copy"><span class="earn-quick-title">Daily GP</span>'+
        '<strong>'+money(board.dailyAmount)+'</strong></div>'+
        '<button type="button" class="primary" data-act="earn-daily">Claim GP</button>'+
        '<div class="earn-countdown" data-countdown="daily" role="timer" aria-live="off" hidden></div>'+
      '</article>'+
      '<article class="earn-quick" aria-label="Bonus GP claim">'+
        '<div class="earn-quick-copy"><span class="earn-quick-title">Bonus GP</span>'+
        '<strong>'+money(rec.amount)+'</strong></div>'+
        '<button type="button" class="primary" data-act="earn-recover">Claim GP</button>'+
        '<div class="earn-countdown" data-countdown="recovery" role="timer" aria-live="off" hidden></div>'+
      '</article></div>';
  }
  // The Collection Log owns all milestone claims. GP eligibility is server-provided.
  function renderMilestones(board,packs,selectedPack='all',error=false){
    if(!board)return '<section class="collection-rewards" aria-label="Collection milestone rewards">'+
      '<div class="collection-rewards-heading"><h3>Milestone rewards</h3></div>'+
      (error?'<p class="collection-rewards-empty">Milestones are unavailable right now. '+
        '<button type="button" class="quiet" data-act="earn-refresh">Try again</button></p>':
        '<p class="collection-rewards-empty" role="status">Loading milestone rewards…</p>')+'</section>';
    const all=Array.isArray(board.milestones)?board.milestones:[];
    const remaining=all.filter(m=>!m.claimed);
    const inView=selectedPack==='all'?remaining:remaining.filter(m=>m.pack===selectedPack);
    const ready=inView.filter(m=>m.available).length;
    const named=new Map((packs||[]).map(p=>[p.id,p]));
    const categories=selectedPack==='all'?[...named.keys()]:[selectedPack];
    const groups=categories.map((id,index)=>{
      const pack=named.get(id);
      if(!pack)return '';
      const items=remaining.filter(m=>m.pack===id);
      const claimed=all.filter(m=>m.pack===id&&m.claimed).length;
      const total=all.filter(m=>m.pack===id).length;
      const expanded=selectedPack!=='all'||items.some(m=>m.available)||(ready===0&&index===0);
      const cards=items.map(m=>{
        const found=Math.max(0,Number(m.found)||0);
        const goal=Math.max(1,Number(m.goal)||1);
        const progress=Math.min(100,found/goal*100);
        const unlocked=Boolean(m.available);
        return '<article class="earn-milestone'+(unlocked?' is-ready':'')+'">'+
          '<div class="earn-milestone-top">'+
            '<span class="earn-milestone-info"><strong>'+esc(m.title)+'</strong>'+
            '<small>'+found.toLocaleString()+' / '+goal.toLocaleString()+' unique items</small></span>'+
            '<span class="earn-milestone-prize">+'+money(m.amount)+'</span></div>'+
          '<div class="earn-milestone-track" role="progressbar" aria-label="'+esc(m.title)+' progress"'+
            ' aria-valuemin="0" aria-valuemax="'+goal+'" aria-valuenow="'+Math.min(found,goal)+'">'+
            '<span style="width:'+progress.toFixed(2)+'%"></span></div>'+
          '<button type="button" class="'+(unlocked?'primary':'quiet')+'" data-act="earn-milestone"'+
            ' data-id="'+esc(m.code)+'"'+(unlocked?'':' disabled')+'>'+
            (unlocked?'Claim +'+money(m.amount):'Locked')+'</button></article>';
      }).join('');
      const complete='<div class="collection-rewards-complete">'+
        '<span aria-hidden="true">✦</span><strong>All rewards claimed</strong></div>';
      return '<details class="collection-reward-group"'+(expanded?' open':'')+'>'+
        '<summary class="collection-reward-group-heading">'+
        '<strong>'+esc(pack.icon||'✦')+' '+esc(pack.name)+'</strong>'+
        '<span>'+claimed+' / '+total+' claimed</span>'+
        '<span class="collection-reward-toggle" aria-hidden="true">▾</span></summary>'+
        (cards?'<div class="earn-milestones">'+cards+'</div>':complete)+'</details>';
    }).join('');
    return '<section class="collection-rewards" aria-label="Collection milestone rewards">'+
      '<div class="collection-rewards-heading"><h3>Milestone rewards</h3>'+
      '<span>'+ready+' ready to claim · '+inView.length+' remaining</span></div>'+
      '<div class="collection-reward-groups">'+groups+'</div></section>';
  }
  function render(board,state,packs,error=false){
    const head='<div class="earn-heading"><div><span class="earn-eyebrow">PLAYER REWARDS</span>'+
      '<h2>Earn GP</h2></div><strong>'+money(state?.gp)+'</strong></div>';
    if(!board)return '<div class="earn-dashboard">'+head+
      (error?'<p class="earn-empty">Rewards are unavailable right now.</p><button type="button" class="quiet" data-act="earn-refresh">Try again</button>':
        '<p class="earn-empty" role="status">Loading rewards…</p>')+'</div>';
    return '<div class="earn-dashboard">'+head+cards(board,state)+'</div>';
  }
  function tick(root,board,state,offset=0,now=Date.now()){
    if(!root||!board||!state)return;
    const daily=secondsRemaining(state.nextDailyAt,offset,now);
    const canDaily=Boolean(state.daily)||!state.nextDailyAt||daily===0;
    const recovery=board.recovery||{};
    const recoverySeconds=secondsRemaining(recovery.nextAt,offset,now);
    const canRecovery=Boolean(recovery.available)||
      (!recovery.balanceTooHigh&&!recovery.pendingPack&&Boolean(recovery.nextAt)&&recoverySeconds===0);
    const set=(action,timerId,enabled,label,seconds)=>{
      const button=root.querySelector('[data-act="'+action+'"]');
      const timer=root.querySelector('[data-countdown="'+timerId+'"]');
      if(button){
        button.disabled=!enabled;
        button.textContent=enabled?'Claim GP':label;
      }
      if(timer){
        timer.hidden=seconds<=0;
        if(seconds>0)timer.innerHTML='Next available claim in <strong>'+clock(seconds)+'</strong>';
        else timer.textContent='';
      }
    };
    set('earn-daily','daily',canDaily,'Claimed',daily);
    set('earn-recover','recovery',canRecovery,
      recoverySeconds>0?'Claimed':recovery.pendingPack?'Finish current pack':recovery.balanceTooHigh?'Unavailable':'On cooldown',recoverySeconds);
  }
  window.ChallengerEconomy={render,renderMilestones,tick,secondsRemaining,clock};
})();
