/* Challenger Rips Equipment v1: render only server-authoritative gear, goals, badges. */
(()=>{
'use strict';
const SLOTS=[
  null,'head',null,
  'cape','neck','ammo',
  'weapon','body','shield',
  null,'legs',null,
  'hands','feet','ring'
];
const ICONS={
 head:'♜',cape:'♧',neck:'◇',ammo:'➹',weapon:'⚔',body:'♜',
 shield:'⬡',legs:'♜',hands:'✥',feet:'♟',ring:'◯'
};
const LABELS={
 head:'Head',cape:'Cape',neck:'Neck',ammo:'Ammo',weapon:'Weapon',
 body:'Body',shield:'Shield',legs:'Legs',hands:'Hands',feet:'Feet',ring:'Ring'
};
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const money=n=>Number(n||0).toLocaleString()+' GP';
const icon=id=>{
 const n=Number(id);
 return Number.isSafeInteger(n)&&n>0?
  'https://static.runelite.net/cache/item/icon/'+n+'.png':'';
};
const itemSprite=(id,name,extra='')=>{
 const src=icon(id);
 return src?
  '<img class="gear-sprite '+extra+'" alt="'+h(name)+'" loading="lazy" src="'+src+
  '" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="gear-art-fallback" hidden aria-hidden="true">⚔</span>':
  '<span class="gear-art-fallback" aria-hidden="true">⚔</span>';
};
const button=(text,act,id='',cls='')=>
  '<button type="button" class="'+h(cls)+'" data-act="'+h(act)+'" data-id="'+h(id)+'">'+h(text)+'</button>';
const pct=x=>{
 const n=Number(x)*100;
 if(!Number.isFinite(n)||n<=0)return 'Unavailable';
 return n.toFixed(n>=10?2:n>=1?3:n>=0.01?4:7).replace(/\.?0+$/,'')+'%';
};
function equippedSlots(data){
 return new Map((data?.slots||[]).map(x=>[x.slot,x]));
}
function definitions(data){
 return new Map((data?.definitions||[]).map(x=>[x.id,x]));
}
function renderEquipment(data,items,selectedSlot){
 const equipped=equippedSlots(data);
 const defs=definitions(data);
 const focused=selectedSlot||'head';
 const currently=equipped.get(focused);
 const currentlyTwoHanded=focused==='shield'&&equipped.get('weapon')?.twoHanded;
 const gearSlots='<div class="gear-slots" role="group" aria-label="Equipped item slots">'+
 SLOTS.map((slot,i)=>{
  if(!slot)return '<div class="gear-slot-space" aria-hidden="true"></div>';
  const item=equipped.get(slot);
  const active=focused===slot,blocked=slot==='shield'&&currentlyTwoHanded;
  return '<button type="button" class="gear-slot'+(item?' has-item':'')+
    (active?' is-active':'')+(blocked?' is-blocked':'')+
    '" data-act="gear-focus" data-id="'+slot+'" aria-pressed="'+active+
    '" aria-label="'+h(LABELS[slot])+': '+(item?h(item.name):blocked?'Occupied by two-handed weapon':'Empty')+'">'+
    (item?itemSprite(item.geId,item.name):
      '<span class="gear-empty-glyph" aria-hidden="true">'+ICONS[slot]+'</span>')+
    '<small>'+LABELS[slot]+'</small></button>';
 }).join('')+'</div>';
 const candidates=(items||[]).filter(a=>defs.get(a.item)?.slot===focused&&!a.listing)
   .sort((a,b)=>Number(equipped.get(focused)?.instance===b.id)-Number(equipped.get(focused)?.instance===a.id));
 const picker=candidates.length?
  '<div class="gear-candidate-grid">'+candidates.map(asset=>{
    const def=defs.get(asset.item);
    const isOn=(data?.slots||[]).some(x=>x.instance===asset.id);
    return '<div class="gear-candidate">'+itemSprite(def.geId,'OSRS equipment')+
      '<span class="gear-candidate-name">'+h(asset.name||asset.item)+'</span>'+
      (isOn?'<strong>Equipped</strong>':
        button('Equip','gear-equip',asset.id,'gear-primary'))+'</div>';
  }).join('')+'</div>':
  '<p class="gear-empty-copy">No compatible banked items yet. Open a pack to collect gear for this slot.</p>';
 const setCount=(data?.sets||[]).filter(s=>s.completed||s.historicalComplete).length;
 const goal=(data?.sets||[]).find(s=>s.id===data?.goal)||(data?.sets||[])[0];
 return '<div class="gear-dashboard">'+
  '<div class="gear-heading"><div><span class="gear-eyebrow">YOUR CHARACTER</span><h2>Equipped gear</h2>'+
  '<p>Equipment is cosmetic and collection-focused. It does not change drop odds or GP rewards.</p></div>'+
  '<div class="gear-stat-pill">'+(data?.slots||[]).length+' / 11 slots equipped</div></div>'+
  '<div class="gear-display">'+
    '<div class="gear-slot-stage"><div class="gear-stage-title">OSRS equipment layout</div>'+gearSlots+'</div>'+
    '<div class="gear-inspector"><span class="gear-eyebrow">SELECTED SLOT</span>'+
    '<h3>'+LABELS[focused]+'</h3>'+
    (currently?'<div class="gear-equipped-detail">'+itemSprite(currently.geId,currently.name)+
      '<div><strong>'+h(currently.name)+'</strong><small>'+money(currently.value)+
      (currently.twoHanded?' · Two-handed':'')+'</small></div></div>'+
      button('Unequip item','gear-unequip',focused,'gear-secondary'):
      '<p class="gear-empty-copy">'+(currentlyTwoHanded?
        'Your two-handed weapon occupies this shield slot. Equip a shield to replace it.':
        'Nothing equipped. Select a compatible banked item below.')+'</p>')+
    '<div class="gear-choices-title">Available in your Bank</div>'+picker+
    '</div></div>'+
    (goal?'<div class="gear-active-goal"><div><span class="gear-eyebrow">ACTIVE EQUIPMENT GOAL</span>'+
      '<strong>'+h(goal.name)+'</strong>'+
      '<small>'+goal.owned+' / '+goal.required+' currently owned · '+goal.discovered+
      ' / '+goal.required+' historically discovered</small></div>'+
      button('View progress','gear-tab','sets','gear-primary')+'</div>':'')+
    '<p class="gear-small-note">Completed collections: '+setCount+
    ' of '+(data?.sets||[]).length+'. Your discovered items remain recorded even when sold.</p>'+
  '</div>';
}
function renderSources(sources,part){
 if(!sources?.length)return '<span class="gear-no-source">No available pack found</span>';
 return '<details class="gear-source-details"><summary>Where to find · '+sources.length+' pack'+
 (sources.length===1?'':'s')+'</summary><div class="gear-source-list">'+
 sources.map(source=>
  '<div class="gear-source"><div><strong>'+h(source.name)+'</strong>'+
   '<small>'+h(source.pack)+' · '+money(source.price)+'</small></div>'+
   '<div class="gear-source-right"><strong>'+pct(source.chance)+'</strong>'+
   button('View pack','gear-pack',source.case,'gear-secondary')+'</div></div>'
 ).join('')+'</div></details>';
}
function renderSets(data){
 const sets=data?.sets||[];
 const pinned=data?.goal;
 return '<div class="gear-sets">'+
   '<div class="gear-heading"><div><span class="gear-eyebrow">LONG-TERM PROGRESSION</span>'+
   '<h2>Equipment sets</h2><p>Pick a goal, collect missing pieces and complete a full outfit.</p></div></div>'+
   '<p class="gear-small-note">Discovered = pulled at least once · Owned = currently banked or equipped · Equipped = currently worn. An earned badge remains permanent.</p>'+
   sets.map(s=>{
     const percent=Math.max(0,Math.min(100,Math.round(100*s.owned/s.required)));
     const found=Math.max(0,Math.min(100,Math.round(100*s.discovered/s.required)));
     return '<article class="gear-set-card" id="gear-set-'+h(s.id)+'">'+
       '<div class="gear-set-top"><div><span class="gear-tier gear-tier-'+h(s.tier)+'">'+h(s.tier)+'</span>'+
       '<h3>'+h(s.name)+'</h3><p>'+h(s.description)+'</p></div>'+
       (s.completed?'<span class="gear-done-pill">✓ Owned complete</span>':pinned===s.id?
        '<span class="gear-pinned-pill">★ Active goal</span>':'')+'</div>'+
       '<div class="gear-progress-label"><strong>'+s.owned+' / '+s.required+' owned</strong><span>'+
       percent+'%</span></div>'+
       '<div class="gear-progress-track"><span style="width:'+percent+'%"></span></div>'+
       '<div class="gear-progress-minor">Discovered '+s.discovered+'/'+s.required+
       ' · Equipped '+s.equipped+'/'+s.required+
       (s.historicalComplete?' · ✓ Discovery badge':'')+'</div>'+
       '<div class="gear-piece-grid">'+(s.pieces||[]).map(part=>{
         const label=part.equipped?'Equipped':part.owned?'In bank':part.discovered?'Discovered · not owned':'Not discovered';
         return '<div class="gear-piece'+(part.owned?' is-owned':' is-missing')+'">'+
          '<div class="gear-piece-art">'+itemSprite(part.geId,part.name)+
            (!part.owned?'<span class="gear-piece-lock" aria-hidden="true">🔒</span>':'')+'</div>'+
          '<strong>'+h(part.name)+'</strong><small>'+h(label)+'</small>'+
          (!part.owned?renderSources(part.sources,part):'')+
          (part.owned&&!part.equipped&&part.instance?
            button('Equip','gear-equip',part.instance,'gear-secondary'):'')+
         '</div>';
       }).join('')+'</div>'+
       '<div class="gear-set-actions">'+
         button(pinned===s.id?'Active goal ✓':'Set as goal','gear-goal',s.id,
           pinned===s.id?'gear-secondary':'gear-primary')+
         button('Equip owned pieces','gear-equip-set',s.id,'gear-secondary')+
         '</div></article>';
   }).join('')+
 '</div>';
}
function renderAchievements(data){
 const badges=data?.achievements||[];
 return '<div class="gear-achievements"><div class="gear-heading"><div><span class="gear-eyebrow">PERMANENT ACCOMPLISHMENTS</span>'+
 '<h2>Achievements and titles</h2><p>Earn badges by equipping items and completing sets. Set progress stays permanent after you sell an item.</p></div></div>'+
 '<div class="gear-badge-grid">'+(badges.length?badges.map(badge=>
  '<div class="gear-badge"><span class="gear-badge-icon">🏆</span>'+
  '<strong>'+h(badge.title)+'</strong><small>'+h(badge.description)+'</small>'+
  '<span class="gear-badge-date">'+new Date(badge.earnedAt).toLocaleDateString()+'</span>'+
  button(data.title===badge.code?'Title equipped ✓':'Use as profile title','gear-title',badge.code,
    data.title===badge.code?'gear-secondary':'gear-primary')+
  '</div>').join(''):'<p class="gear-empty-copy">Your first achievement unlocks when you equip a piece of gear.</p>')+
  '</div>'+(data?.title?button('Clear displayed title','gear-title','none','gear-secondary'):'')+
  '</div>';
}
function render(root,data,items,tab,focus){
 if(!root)return;
 if(!data){root.innerHTML='<div class="gear-unavailable">Equipment is unavailable. Try reloading your Bank.'+
 button('Retry','gear-refresh','','gear-secondary')+'</div>';return;}
 const joined=items.map(a=>({...a,name:window.ChallengerGearItemName?.(a.item)||a.item}));
 root.innerHTML=
   '<div class="gear-subtabs" aria-label="Equipment areas">'+
   ['equipment','sets','achievements'].map(k=>button(
     k==='equipment'?'Equipment':k==='sets'?'Sets':'Achievements','gear-tab',k,
     'gear-subtab'+(tab===k?' is-active':''))).join('')+'</div>'+
   (tab==='equipment'?renderEquipment(data,joined,focus):
    tab==='sets'?renderSets(data):renderAchievements(data));
}
function renderShowcase(profile){
 if(!profile)return '';
 const slots=profile.slots||[],badges=profile.badges||[];
 return '<section class="gear-showcase"><div class="gear-heading"><div><span class="gear-eyebrow">PLAYER EQUIPMENT</span>'+
 '<h3>'+h(profile.name||'Player')+(profile.title?' · '+h(profile.title):'')+'</h3></div></div>'+
 '<div class="gear-showcase-items">'+(slots.length?slots.map(a=>
  '<div class="gear-showcase-item">'+itemSprite(a.geId,a.name)+'<strong>'+h(a.name)+'</strong>'+
  '<small>'+h(LABELS[a.slot]||a.slot)+'</small></div>').join(''):
  '<p class="gear-empty-copy">No equipment on display yet.</p>')+'</div>'+
 (badges.length?'<div class="gear-showcase-badges">'+badges.slice(0,6).map(b=>
  '<span class="gear-showcase-badge">🏆 '+h(b.title)+'</span>').join('')+'</div>':'')+'</section>';
}
window.ChallengerGear={render,renderShowcase,definitions,equippedSlots,slots:LABELS};
})();