/* Challenger Rips: premium post-purchase reveal and GP reward decisions.
   No client-side reward draws or user-submitted sale prices. */
(() => {
  'use strict';
  const root = document.createElement('div');
  root.id = 'cr-reveal';
  root.hidden = true;
  root.setAttribute('role','dialog');
  root.setAttribute('aria-modal','true');
  root.setAttribute('aria-label','Pack rewards');
  document.body.append(root);

  const h = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const gp = value => value == null ? 'Price unavailable' :
    Number(value).toLocaleString('en-US')+' GP';
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const catalogItem = (session, r) => r?.item ? session.ctx.catalog.get(r.item) : null;
  const itemValue = (session,r) => r.value == null ? catalogItem(session,r)?.guide ?? null : Number(r.value);
  const itemName = (session,r) => h(catalogItem(session,r)?.name || 'Unknown reward');
  const itemIcon = (session,r) => {
    const id=Number(catalogItem(session,r)?.ge);
    return Number.isSafeInteger(id) && id>0
      ? '<img draggable="false" alt="'+itemName(session,r)+'" loading="eager" src="https://static.runelite.net/cache/item/icon/'+id+'.png" onerror="this.hidden=true">'
      : '<span class="cr-unknown" aria-label="Decorative item symbol">'+
          (catalogItem(session,r)?.pack==='pets'?'🐾':'✦')+'</span>';
  };
  const itemTint = (session,r) => {
    const item=catalogItem(session,r);
    const pack=session.ctx.cases.find(c=>c.id===session.batch.case);
    const ratio=(Number(item?.guide)||0)/Math.max(Number(pack?.price)||1,1);
    return ratio>=12?'#efbc63':ratio>=2?'#bb92ed':ratio>=1?'#6dbfe8':'#82c0ac';
  };

  class PremiumReveal {
    constructor(){
      this.ctx=null;
      this.batch=null;
      this.phase='opening';
      this.selected=new Set();
      this.newFlips=new Set();
      this.busy=false;
      this.detail=false;
      this.timer=null;
      this.epoch=0;
      this.toast='';
      this.rip=null;
      this.ripped=false;
      this.renderedPhase=null;
      root.addEventListener('click', e => this.click(e));
      root.addEventListener('pointerdown', e => this.ripStart(e));
      root.addEventListener('pointermove', e => this.ripMove(e));
      root.addEventListener('pointerup', e => this.ripEnd(e));
      root.addEventListener('pointercancel', e => this.ripEnd(e,true));
      root.addEventListener('lostpointercapture', e => this.ripEnd(e,true));
      window.addEventListener('keydown', e => {
        if(!root.hidden && e.key==='Escape'){
          e.preventDefault();this.close();
        }
      });
    }
    open(batch,ctx) {
      if(!batch?.id || !Array.isArray(batch.rewards))return;
      this.stopTimer();
      this.ctx=ctx;
      this.batch=batch;
      this.selected.clear();
      this.newFlips.clear();
      this.toast='';
      this.detail=false;
      this.busy=false;
      this.rip=null;
      this.ripped=false;
      this.renderedPhase=null;
      root.style.setProperty('--cr-rip-progress','0');
      root.classList.remove('cr-rip-dragging','cr-rip-progress','cr-rip-reverse');
      const allRevealed=batch.rewards.every(r=>r.revealed || r.item);
      const anythingRevealed=batch.rewards.some(r=>r.revealed || r.item);
      this.phase=allRevealed?(batch.rewards.length===1?'single':'results'):(anythingRevealed?'cards':'opening');
      root.hidden=false;
      document.body.classList.add('cr-reveal-active');
      this.render();
    }
    stopTimer(){
      if(this.timer!==null)window.clearTimeout(this.timer);
      this.timer=null;
      this.epoch++;
    }
    schedule(fn,ms){
      this.stopTimer();
      const generation=this.epoch;
      this.timer=window.setTimeout(()=>{
        this.timer=null;
        if(generation===this.epoch && !root.hidden)fn();
      },reduced()?5:ms);
    }
    // Opening is deliberately user controlled: a tap or an elapsed timer cannot unseal a pack.
    ripStart(e){
      if(root.hidden||this.phase!=='opening'||this.ripped||this.busy||this.rip)return;
      if(e.pointerType==='mouse'&&e.button!==0)return;
      const grip=e.target.closest('.cr-rip-target');
      if(!grip)return;
      const bounds=grip.getBoundingClientRect();
      this.rip={id:e.pointerId,startX:e.clientX,required:Math.max(80,bounds.width*.62),progress:0};
      root.classList.add('cr-rip-dragging');
      root.style.setProperty('--cr-rip-light-x','2%');
      root.style.setProperty('--cr-rip-lift','0px');
      try{grip.setPointerCapture(e.pointerId);}catch{}
    }
    ripMove(e){
      if(!this.rip||this.rip.id!==e.pointerId)return;
      const delta=e.clientX-this.rip.startX;
      const progress=Math.min(1,Math.abs(delta)/this.rip.required);
      this.rip.progress=progress;
      root.style.setProperty('--cr-rip-progress',progress.toFixed(3));
      root.style.setProperty('--cr-rip-light-x',(delta<0?98-progress*96:2+progress*96).toFixed(2)+'%');
      root.style.setProperty('--cr-rip-lift',(-4*progress).toFixed(2)+'px');
      root.classList.toggle('cr-rip-reverse',delta<0);
      root.classList.toggle('cr-rip-progress',progress>.03);
      if(e.cancelable)e.preventDefault();
    }
    ripEnd(e,cancelled=false){
      if(!this.rip||this.rip.id!==e.pointerId)return;
      const progress=this.rip.progress;
      this.rip=null;
      root.classList.remove('cr-rip-dragging','cr-rip-progress');
      if(!cancelled&&progress>=.8){this.completeRip();return;}
      root.style.setProperty('--cr-rip-progress','0');
      root.style.setProperty('--cr-rip-light-x','2%');
      root.style.setProperty('--cr-rip-lift','0px');
      root.classList.remove('cr-rip-reverse');
    }
    completeRip(){
      if(root.hidden||this.phase!=='opening'||this.ripped||this.busy)return;
      this.ripped=true;
      this.rip=null;
      root.style.setProperty('--cr-rip-progress','1');
      root.classList.remove('cr-rip-dragging','cr-rip-progress');
      root.querySelector('.cr-opening')?.classList.add('cr-ripped');
      // Let the light sweep, metallic seal peel, and soft reveal play without
      // recalculating or drawing any reward on the client.
      this.schedule(()=>this.advanceOpening(),reduced()?5:820);
    }
    advanceOpening(){
      if(this.busy)return;
      if(this.batch.rewards.length===1){
        const only=this.batch.rewards[0];
        if(only.revealed||only.item){
          this.phase='single';this.render();return;
        }
        this.revealSlot(only.slot);
      }else{
        this.phase='cards';
        this.render();
      }
    }
    close(message=''){
      this.stopTimer();
      root.hidden=true;
      root.replaceChildren();
      root.style.setProperty('--cr-rip-progress','0');
      root.classList.remove('cr-rip-dragging','cr-rip-progress','cr-rip-reverse');
      this.rip=null;
      this.ripped=false;
      document.body.classList.remove('cr-reveal-active');
      this.detail=false;
      this.busy=false;
      this.selected.clear();
      if(message && this.ctx?.notice) this.ctx.notice(message);
      if(this.ctx?.render)this.ctx.render();
    }
    entry(){
      const found=this.ctx.cases.find(c=>c.id===this.batch.case)||
        {name:'Loot pack',price:this.batch.paid,theme:'bronze',accent:'#d18d51',symbol:'⚔',pack:'boss'};
      return this.ctx.packVisual?this.ctx.packVisual(found):found;
    }
    available(){return this.batch.rewards.filter(r=>r.status!=='sold'&&r.status!=='vaulted');}
    valueTotal(rows){return rows.reduce((sum,r)=>sum+Number(itemValue(this,r)||0),0);}
    toolbar(extra=''){
      return '<div class="cr-toolbar"><button type="button" class="cr-icon-button" data-cr="back" aria-label="Close rewards">←</button>'+
        '<div class="cr-toolbar-actions">'+extra+
        '<button type="button" class="cr-icon-button" data-cr="info" aria-label="Reward information">ⓘ</button></div></div>';
    }
    ambient(){
      return '<div class="cr-sky" aria-hidden="true"></div><div class="cr-light" aria-hidden="true"></div>';
    }
    info(){
      if(!this.detail)return '';
      const entry=this.entry(),r=this.batch.rewards[0];
      const stamp=r?.priceUpdated?new Date(r.priceUpdated).toLocaleString(): 'Not available';
      return '<div class="cr-detail" role="note"><strong>'+h(entry.name)+'</strong>'+
        '<p style="margin-top:6px">'+h(this.batch.rewards.length)+' reward(s), each from a server-side purchase.</p>'+
        '<p style="margin-top:7px">Values are server-issued GE guides. Actual sales are verified when sold.</p>'+
        (this.batch.rewards.length===1?'<p style="margin-top:7px">Last quote: '+h(stamp)+'</p>':'')+'</div>';
    }
    render(){
      if(root.hidden||!this.batch)return;
      const phaseChanged=this.phase!==this.renderedPhase;
      this.renderedPhase=this.phase;
      const entry=this.entry();
      const tone=/^#[0-9a-f]{3,8}$/i.test(entry.accent||'')?entry.accent:'#ce8954';
      root.style.setProperty('--cr-glow',tone);
      const top=this.toolbar();
      let inside='';
      if(this.phase==='opening'){
        const count=this.batch.rewards.length;
        const packs=Array.from({length:count},(_,i)=>{
          const delta=(i-(count-1)/2);
          return '<div class="cr-pack-piece" style="--dx:'+Math.round(delta*15)+'px;--dy:'+Math.round(-i*11)+'px;--rotate:'+Math.round(delta*3)+'deg;--delay:'+i*95+'ms">'+
            this.ctx.foilArt(entry)+
            '<div class="cr-rip-assembly" aria-hidden="true">'+
            '<span class="cr-rip-seam"></span><span class="cr-rip-light"></span>'+
            '<span class="cr-rip-flap"></span><span class="cr-rip-flare"></span>'+
            '<span class="cr-rip-sparks"><i></i><i></i><i></i><i></i><i></i><i></i></span>'+
            '</div>'+
            (i===count-1?'<button type="button" class="cr-rip-target" data-cr="rip" aria-label="Swipe horizontally to open pack. Press Enter or Space to open with a keyboard."></button>':'')+'</div>';
        }).join('');
        inside='<section class="cr-stage cr-opening">'+
          '<div class="cr-burst"></div><div class="cr-stack">'+packs+'</div></section>';
      }else if(this.phase==='cards'){
        const cards=this.batch.rewards.map(r=>{
          const flipped=Boolean(r.revealed||r.item);
          const pendingFlip=this.newFlips.has(r.slot);
          return '<button type="button" class="cr-turn'+(flipped&&!pendingFlip?' cr-flipped':'')+
            '" data-cr="flip" data-slot="'+r.slot+'" aria-label="'+(flipped?'Revealed reward':'Reveal reward')+' '+r.slot+'"'+
            (flipped||this.busy?' disabled':'')+'><span class="cr-card-inner">'+
            '<span class="cr-card-back"><span class="cr-stamp">CR</span><span class="cr-stamp-sub">CHALLENGER RIPS</span></span>'+
            '<span class="cr-card-front" style="--cr-item-tint:'+itemTint(this,r)+'">'+
            (flipped?itemIcon(this,r)+'<h3>'+itemName(this,r)+'</h3><p>'+gp(itemValue(this,r))+'</p>':'')+
            '</span></span></button>';
        }).join('');
        const remaining=this.batch.rewards.filter(r=>!r.revealed&&!r.item).length;
        inside='<section class="cr-stage"><div class="cr-deck">'+
          '<div class="cr-reveal-grid">'+cards+'</div></div>'+
          '<div class="cr-subactions">'+(remaining?'<button data-cr="reveal-all"'+(this.busy?' disabled':'')+'>Reveal all</button>':'')+
          '</div></section>';
      }else if(this.phase==='single'){
        const r=this.batch.rewards[0];
        const tint=itemTint(this,r);
        inside='<section class="cr-stage cr-single" style="--cr-item-tint:'+tint+'">'+
          '<div class="cr-single-art">'+itemIcon(this,r)+'</div>'+
          '<div class="cr-single-info"><div class="cr-summary-value">'+gp(itemValue(this,r))+'</div>'+
          '<div class="cr-single-name">'+itemName(this,r)+'</div></div></section>'+
          this.actions([r],false);
      }else{
        const rows=this.available().filter(r=>r.revealed||r.item);
        const targets=this.selected.size?rows.filter(r=>this.selected.has(r.slot)):rows;
        const label=this.selected.size?this.selected.size+' / '+rows.length+' items selected':
          rows.length+' item'+(rows.length===1?'':'s');
        const cards=rows.map(r=>{
          const isSelected=this.selected.has(r.slot);
          return '<button type="button" class="cr-result-card" aria-pressed="'+isSelected+'" data-cr="select" data-slot="'+r.slot+
            '" style="--cr-item-tint:'+itemTint(this,r)+'">'+
            '<span class="cr-check" aria-hidden="true">✓</span><span class="cr-result-art">'+itemIcon(this,r)+'</span>'+
            '<span class="cr-result-name">'+itemName(this,r)+'</span>'+
            '<span class="cr-result-price">'+gp(itemValue(this,r))+'</span></button>';
        }).join('');
        inside='<section class="cr-stage cr-results"><div class="cr-summary"><div class="cr-summary-label">'+label+
          '</div><div class="cr-summary-value">'+gp(this.valueTotal(targets))+'</div></div>'+
          '<div class="cr-results-scroll"><div class="cr-results-grid">'+cards+'</div></div></section>'+
          this.actions(targets,true);
      }
      root.innerHTML=this.ambient()+'<div class="cr-shell">'+top+inside+
        this.info()+(this.toast?'<div class="cr-toast" role="status">'+h(this.toast)+'</div>':'')+'</div>';
      if(phaseChanged)root.querySelector('.cr-stage')?.classList.add('cr-phase-enter');
      if(this.phase==='cards' && this.newFlips.size){
        const flipped=[...this.newFlips];
        this.newFlips.clear();
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          for(const slot of flipped){
            root.querySelector('.cr-turn[data-slot="'+slot+'"]')?.classList.add('cr-flipped');
          }
        }));
      }
    }
    // Incrementally update multi-pack card faces instead of replacing the
    // entire reveal DOM. Rebuilding the animated sky, glow and all 3D cards on
    // every flip made the whole screen flash and replayed other card animations.
    updateCardsInPlace(){
      if(root.hidden||this.phase!=='cards'||this.renderedPhase!=='cards')return false;
      const grid=root.querySelector('.cr-reveal-grid');
      const subactions=root.querySelector('.cr-subactions');
      if(!grid||!subactions||grid.querySelectorAll('.cr-turn').length!==this.batch.rewards.length)
        return false;
      const newlyRevealed=[];
      for(const reward of this.batch.rewards){
        const card=grid.querySelector('.cr-turn[data-slot="'+reward.slot+'"]');
        if(!card)return false;
        const flipped=Boolean(reward.revealed||reward.item);
        card.disabled=flipped||this.busy;
        card.setAttribute('aria-label',(flipped?'Revealed reward':'Reveal reward')+' '+reward.slot);
        if(flipped&&!card.classList.contains('cr-flipped')){
          const front=card.querySelector('.cr-card-front');
          if(!front)return false;
          front.style.setProperty('--cr-item-tint',itemTint(this,reward));
          front.innerHTML=itemIcon(this,reward)+'<h3>'+itemName(this,reward)+
            '</h3><p>'+gp(itemValue(this,reward))+'</p>';
          newlyRevealed.push(card);
        }
      }
      const remaining=this.batch.rewards.some(r=>!r.revealed&&!r.item);
      const revealAll=subactions.querySelector('[data-cr="reveal-all"]');
      if(!remaining)revealAll?.remove();
      else if(revealAll)revealAll.disabled=this.busy;
      // Retain all existing card and background nodes while the selected card flips.
      this.newFlips.clear();
      if(reduced()){
        for(const card of newlyRevealed)card.classList.add('cr-flipped');
      }else if(newlyRevealed.length){
        requestAnimationFrame(()=>requestAnimationFrame(()=>{
          if(root.hidden||this.phase!=='cards')return;
          for(const card of newlyRevealed){
            if(card.isConnected)card.classList.add('cr-flipped');
          }
        }));
      }
      return true;
    }
    // Selecting revealed items is another frequent interaction. Update only
    // the selected styling, summary, and action buttons; keep the entire
    // results scene (including the background animation) mounted.
    updateResultsInPlace(){
      if(root.hidden||this.phase!=='results'||this.renderedPhase!=='results')return false;
      const stage=root.querySelector('.cr-results');
      const cards=stage?.querySelectorAll('.cr-result-card');
      const labels=stage?.querySelector('.cr-summary-label');
      const value=stage?.querySelector('.cr-summary-value');
      const actions=root.querySelector('.cr-actions');
      const rows=this.available().filter(r=>r.revealed||r.item);
      if(!stage||!cards||cards.length!==rows.length||!labels||!value||!actions)return false;
      const selectedRows=this.selected.size?rows.filter(r=>this.selected.has(r.slot)):rows;
      for(const card of cards){
        card.setAttribute('aria-pressed',String(this.selected.has(Number(card.dataset.slot))));
      }
      labels.textContent=this.selected.size?
        this.selected.size+' / '+rows.length+' items selected':
        rows.length+' item'+(rows.length===1?'':'s');
      value.textContent=gp(this.valueTotal(selectedRows));
      // The first phase entrance should not replay or obscure selection.
      stage.classList.remove('cr-phase-enter');
      root.querySelector('.cr-sale-note')?.remove();
      actions.outerHTML=this.actions(selectedRows,true);
      return true;
    }
    actions(rows,multiple){
      const count=rows.length,select=this.selected.size>0;
      const suffix=multiple && select?' ('+count+')':multiple?' ALL':'';
      const saleEligible=Boolean(count)&&rows.every(r=>{
        const item=catalogItem(this,r);
        const last=Date.parse(item?.guideTime);
        return Number(item?.ge)>0&&Number(item?.guide)>0&&
          Number.isFinite(last)&&last>Date.now()-24*60*60*1000;
      });
      return '<div class="cr-actions" role="group" aria-label="Manage your rewards">'+
        '<button data-cr="sell"'+(this.busy||!saleEligible?' disabled':'')+
        ' title="'+(saleEligible?'Sell at the current server-verified GE guide':'GE selling unavailable for these rewards')+
        '" aria-label="Sell '+count+' rewards">SELL'+suffix+'</button>'+
        '<button data-cr="vault"'+(this.busy||!count?' disabled':'')+' aria-label="Vault '+count+' rewards">VAULT'+suffix+'</button></div>'+
        (!saleEligible&&count?'<p class="cr-sale-note">GE selling is unavailable for this selection. You can keep these rewards in your vault.</p>':'');
    }
    async revealSlot(slot=null){
      if(this.busy || root.hidden)return;
      this.busy=true;
      this.toast='';
      try{
        const before=new Set(this.batch.rewards.filter(r=>r.revealed||r.item).map(r=>r.slot));
        const data=await this.ctx.rpc('reward_reveal',{batch:this.batch.id,...(slot===null?{}:{slot})});
        if(!data?.rewards)throw Error('Reward reveal is unavailable.');
        this.batch=data;
        this.newFlips=new Set(data.rewards.filter(r=>r.revealed&&!before.has(r.slot)).map(r=>r.slot));
        this.busy=false;
        if(data.rewards.length===1){
          this.phase='single';this.render();
        }else{
          const flipCount=this.newFlips.size;
          this.phase='cards';
          // Do not redraw the fullscreen background and previously flipped
          // cards for each separately revealed reward.
          if(!this.updateCardsInPlace())this.render();
          if(data.rewards.every(r=>r.revealed||r.item)){
            this.schedule(()=>{this.phase='results';this.render();},
              Math.max(850,800+flipCount*85));
          }
        }
      }catch(error){
        this.busy=false;this.toast=error.message||'Unable to reveal this reward.';
        if(this.phase==='opening'){
          this.ripped=false;
          root.style.setProperty('--cr-rip-progress','0');
        }
        this.render();
      }
    }
    async settle(decision){
      if(this.busy||root.hidden)return;
      const list=this.available().filter(r=>r.revealed||r.item);
      const targets=this.selected.size?list.filter(r=>this.selected.has(r.slot)):list;
      if(!targets.length)return;
      const slots=targets.map(r=>r.slot);
      const previousGp=this.ctx.getBalance?.();
      this.busy=true;this.toast='';
      this.render();
      try{
        const result=await this.ctx.rpc('reward_settle',{batch:this.batch.id,slots,decision});
        if(!result?.rewards)throw Error('Unable to settle these rewards.');
        const amount=targets.reduce((sum,r)=>{
          const confirmed=result.rewards.find(x=>x.slot===r.slot);
          return sum+Number(confirmed?.settledValue||0);
        },0);
        this.batch=result;
        this.selected.clear();
        await this.ctx.load();
        if(decision==='sell')this.ctx.onWalletChange?.(previousGp,'sell');
        if(result.remaining===0){
          this.close(decision==='sell'?'Sold rewards for '+gp(amount)+'.':'Rewards saved in your inventory.');
          return;
        }
        this.phase='results';
        this.toast=decision==='sell'?'Sold '+slots.length+' reward(s) for '+gp(amount)+'.':
          'Vaulted '+slots.length+' reward(s).';
        this.busy=false;
        this.render();
      }catch(error){
        this.busy=false;
        this.toast=error.message||'Unable to manage rewards.';
        this.render();
      }
    }
    click(e){
      const target=e.target.closest('button[data-cr]');
      if(!target || root.hidden)return;
      const action=target.dataset.cr;
      if(action==='back'){this.close();return;}
      if(action==='info'){this.detail=!this.detail;this.render();return;}
      if(this.busy)return;
      if(action==='rip'){
        // Native keyboard/assistive-tech activation is available without making a tap open the pack.
        if(e.detail===0)this.completeRip();
        return;
      }
      if(action==='flip'){
        if(this.phase==='cards')this.revealSlot(Number(target.dataset.slot));
        return;
      }
      if(action==='reveal-all'){this.revealSlot(null);return;}
      if(action==='select'){
        if(this.phase!=='results')return;
        const slot=Number(target.dataset.slot);
        if(this.selected.has(slot))this.selected.delete(slot);
        else this.selected.add(slot);
        if(!this.updateResultsInPlace())this.render();
        return;
      }
      if(action==='sell'||action==='vault')this.settle(action);
    }
  }
  window.PremiumReveal=new PremiumReveal();
})();