/* Challenger Rips Earn GP.
   All claim eligibility, progression and GP amounts are authenticated Supabase data.
   Timers are presentational: the server remains authoritative. */
(()=>{
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
  const money=n=>(Number(n)||0).toLocaleString('en-US')+' GP';
  let selectedPack=null;

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
  function milestones(board,packs){
    const milestones=Array.isArray(board.milestones)?board.milestones:[];
    const pending=milestones.filter(item=>!item.claimed);
    const categories=[...new Set([
      ...(packs||[]).map(pack=>pack.id),
      ...milestones.map(item=>item.pack)
    ])];
    const named=new Map((packs||[]).map(pack=>[pack.id,pack]));
    if(!categories.includes(selectedPack))selectedPack=categories[0]||null;
    const ready=pending.filter(item=>item.available).length;
    const tabs=categories.map(pack=>{
      const related=pending.filter(item=>item.pack===pack);
      const active=pack===selectedPack;
      const info=named.get(pack);
      return '<button type="button" class="earn-pack-tab'+(active?' is-active':'')+
        '" data-act="earn-pack-tab" data-id="'+esc(pack)+'" role="tab" aria-selected="'+active+
        '" aria-controls="earn-milestone-panel" tabindex="'+(active?'0':'-1')+'">'+
        '<span class="earn-pack-icon" aria-hidden="true">'+esc(info?.icon||'✦')+'</span>'+
        '<span class="earn-pack-name">'+esc(info?.name||pack)+'</span>'+
        '<span class="earn-pack-count">'+related.length+'</span></button>';
    }).join('');
    const visible=pending.filter(item=>item.pack===selectedPack);
    const totalForPack=milestones.filter(item=>item.pack===selectedPack).length;
    const available=visible.filter(item=>item.available).length;
    const rows=visible.map(item=>{
      const found=Math.max(0,Number(item.found)||0);
      const goal=Math.max(1,Number(item.goal)||1);
      const progress=Math.max(0,Math.min(100,found/goal*100));
      const ready=Boolean(item.available);
      return '<div class="earn-milestone'+(ready?' is-ready':'')+'">'+
        '<div class="earn-milestone-top">'+
          '<span class="earn-milestone-info"><strong>'+esc(item.title)+'</strong>'+
          '<small>'+found.toLocaleString()+' / '+goal.toLocaleString()+' unique items</small></span>'+
          '<span class="earn-milestone-prize">+'+money(item.amount)+'</span></div>'+
        '<div class="earn-milestone-track" role="progressbar" aria-label="'+esc(item.title)+' progress" '+
          'aria-valuemin="0" aria-valuemax="'+goal+'" aria-valuenow="'+Math.min(found,goal)+'">'+
          '<span style="width:'+progress.toFixed(2)+'%"></span></div>'+
        '<button type="button" class="'+(ready?'primary':'quiet')+'" data-act="earn-milestone" '+
          'data-id="'+esc(item.code)+'"'+(ready?'':' disabled')+'>'+
          (ready?'Claim reward':'Locked')+'</button>'+
      '</div>';
    }).join('');
    const empty='<div class="earn-milestone-empty">'+
      '<span aria-hidden="true">✦</span><strong>Collection complete</strong>'+
      '<p>All GP milestones claimed for this collection.</p></div>';
    return '<section class="earn-milestone-section" aria-label="Collection milestones">'+
      '<div class="earn-section-heading"><h3>Collection milestones</h3>'+
        '<span>'+ready+' ready · '+pending.length+' remaining</span></div>'+
      '<div class="earn-log-shell">'+
        '<div class="earn-pack-tabs" role="tablist" aria-label="Collection categories">'+tabs+'</div>'+
        '<div class="earn-log-panel" id="earn-milestone-panel" role="tabpanel">'+
          '<div class="earn-log-top"><strong>'+esc(named.get(selectedPack)?.name||selectedPack||'Collections')+'</strong>'+
          '<span>'+available+' ready · '+visible.length+' / '+totalForPack+' remaining</span></div>'+
          (rows?'<div class="earn-milestones">'+rows+'</div>':empty)+
        '</div></div></section>';
  }
  function render(board,state,packs,error=false){
    const head='<div class="earn-heading"><div><span class="earn-eyebrow">PLAYER REWARDS</span>'+
      '<h2>Earn GP</h2></div><strong>'+money(state?.gp)+'</strong></div>';
    if(!board)return '<div class="earn-dashboard">'+head+
      (error?'<p class="earn-empty">Rewards are unavailable right now.</p><button type="button" class="quiet" data-act="earn-refresh">Try again</button>':
        '<p class="earn-empty" role="status">Loading rewards…</p>')+'</div>';
    return '<div class="earn-dashboard">'+head+cards(board,state)+milestones(board,packs)+'</div>';
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
      recovery.pendingPack?'Finish current pack':recovery.balanceTooHigh?'Unavailable':'Claimed',recoverySeconds);
  }
  function choosePack(id,board){
    const exists=Array.isArray(board?.milestones)&&board.milestones.some(item=>item.pack===id);
    if(exists){selectedPack=id;return true;}
    return false;
  }
  window.ChallengerEconomy={render,tick,choosePack,secondsRemaining,clock};
})();
