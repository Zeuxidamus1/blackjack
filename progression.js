/* Challenger Rips collection journeys.
   Read-only milestones calculated from authenticated, server-returned pull history.
   No GP rewards, client-side purchases, or new database state. */
(()=>{
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
  const milestones=total=>{
    if(total<=0)return [];
    const levels=[
      {name:'First find',count:1},
      {name:'Scout',count:Math.max(2,Math.ceil(total*.10))},
      {name:'Collector',count:Math.max(3,Math.ceil(total*.25))},
      {name:'Veteran',count:Math.max(4,Math.ceil(total*.50))},
      {name:'Complete',count:total}
    ];
    const unique=new Map();
    for(const level of levels)if(level.count<=total)unique.set(level.count,level);
    return [...unique.values()].sort((a,b)=>a.count-b.count);
  };
  function model(catalog,pulls,packs){
    const distinct=new Map();
    for(const item of catalog||[]){
      if(item&&item.id!=null&&!distinct.has(item.id))distinct.set(item.id,item);
    }
    const items=[...distinct.values()];
    const history=pulls||{};
    const discovered=item=>Object.prototype.hasOwnProperty.call(history,item.id)&&
      Boolean(history[item.id])&&
      (typeof history[item.id]!=='object'||Number(history[item.id].count??1)>0);
    const groups=(packs||[]).map(pack=>{
      const entries=items.filter(item=>item.pack===pack.id);
      const total=entries.length;
      const found=entries.filter(discovered).length;
      const steps=milestones(total);
      const earned=steps.filter(step=>found>=step.count).at(-1)||null;
      const next=steps.find(step=>found<step.count)||null;
      return {id:pack.id,name:pack.name,icon:pack.icon,total,found,earned,next,
        percent:total?Math.round(found/total*1000)/10:0};
    });
    const total=items.length,found=items.filter(discovered).length;
    return {found,total,percent:total?Math.round(found/total*1000)/10:0,groups,
      earned:groups.reduce((n,group)=>n+(group.earned?1:0),0)};
  }
  const percent=n=>n>0&&n<1?'Less than 1%':n.toLocaleString('en-US',{maximumFractionDigits:1})+'%';
  function render(data){
    const result=model(data.catalog,data.pulls,data.packs);
    const overall='<div class="collection-journey-header">'+
      '<div><span class="collection-journey-kicker">COLLECTION JOURNEY</span>'+
      '<h3>Build your collection</h3></div>'+
      '<div class="collection-journey-total"><strong>'+result.found.toLocaleString()+' / '+result.total.toLocaleString()+'</strong>'+
      '<span>unique items discovered</span></div></div>'+
      '<div class="collection-journey-track" role="progressbar" aria-label="Overall collection completion" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+result.percent+'">'+
      '<span style="width:'+result.percent+'%"></span></div>';
    const groups=result.groups.map(group=>{
      const active=group.id===data.selectedPack;
      const status=group.total===0?'No items available':
        group.earned?(group.earned.name==='Complete'?'Collection complete':'Reached: '+group.earned.name):
          'First find available';
      const next=group.total===0?'':group.next?
        '<span class="collection-goal-next">Next: '+escape(group.next.name)+' at '+group.next.count.toLocaleString()+'</span>':
        '<span class="collection-goal-next">All discovery goals reached</span>';
      return '<button type="button" class="collection-goal'+(active?' is-active':'')+
        '" data-act="collection-progress-pack" data-id="'+escape(group.id)+'" aria-pressed="'+active+'"'+
        (group.total===0?' disabled':'')+' aria-label="Show '+escape(group.name)+' collection items, '+group.found+' of '+group.total+' discovered">'+
        '<span class="collection-goal-heading"><span class="collection-goal-name">'+escape(group.icon)+' '+escape(group.name)+'</span>'+
        '<strong>'+percent(group.percent)+'</strong></span>'+
        '<span class="collection-goal-track"><span style="width:'+group.percent+'%"></span></span>'+
        '<span class="collection-goal-count">'+group.found.toLocaleString()+' / '+group.total.toLocaleString()+' items</span>'+
        '<span class="collection-goal-status">'+escape(status)+'</span>'+next+'</button>';
    }).join('');
    return '<div class="collection-journey">'+overall+
      '<div class="collection-goal-list" role="group" aria-label="Collection progress by pack">'+groups+'</div></div>';
  }
  window.ChallengerProgression={model,render};
})();
