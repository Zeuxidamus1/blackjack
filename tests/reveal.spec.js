import {test,expect} from '@playwright/test';

const ITEM_VALUES=[12000,22000,36000,49000,66000];
const mockCatalog=ITEM_VALUES.map((value,i)=>({
  id:'test_item_'+i,pack:'boss',weight:2000,ge:1115+i,
  name:['Rune scimitar','Dragon platelegs','Abyssal whip','Dragon boots','Bandos tassets'][i],
  guide:value,guideTime:new Date().toISOString(),
  salvage:0,found:0,circulation:0
}));
const boss={
  id:'boss-starter',pack:'boss',name:'Starter Loot',price:1000,
  theme:'bronze',accent:'#d28e4a',symbol:'⚔',description:'Starter prizes',
  rewards:mockCatalog.map((v,i)=>({id:v.id,weight:i===4?992000:2000,chase:i===0})),
  configVersion:2
};
async function setup(page,{gp=100000,viewport,customPet=false,staleGeHours=null}={}){
  const testCatalog=mockCatalog.map((item,i)=>{
    if(i!==0)return item;
    if(customPet)return {
      ...item,id:'pets_abyssal_orphan',pack:'pets',name:'Abyssal orphan',
      ge:null,guide:5000000,guideTime:null
    };
    return staleGeHours===null?item:{
      ...item,guideTime:new Date(Date.now()-staleGeHours*3600000).toISOString()
    };
  });
  const testCase=customPet?{
    ...boss,rewards:boss.rewards.map((reward,i)=>i===0?
      {...reward,id:'pets_abyssal_orphan'}:reward)
  }:boss;
  if(viewport)await page.setViewportSize(viewport);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:''
  }));
  await page.route('https://static.runelite.net/**',route=>route.fulfill({
    status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64')
  }));
  await page.addInitScript(({mockCatalog,boss,gp})=>{
    const id='11111111-1111-4111-8111-111111111111';
    const now=new Date().toISOString();
    let backend=JSON.parse(sessionStorage.getItem('reveal-mock')||'null')||
      {gp,inventory:[],batch:null,purchases:0,settlements:0};
    const save=()=>sessionStorage.setItem('reveal-mock',JSON.stringify(backend));
    const snapshot=()=>{
      const b=backend.batch;if(!b)return null;
      return {id:b.id,case:b.case,quantity:b.quantity,paid:b.paid,
        remaining:b.rewards.filter(r=>r.status==='pending').length,
        rewards:b.rewards.map(r=>({
          slot:r.slot,revealed:r.revealed,status:r.status,
          item:r.revealed?r.item:null,
          instance:r.revealed&&r.status==='pending'?r.instance:null,
          value:r.revealed?mockCatalog.find(c=>c.id===r.item).guide:null,
          settledValue:r.settledValue??null,
          priceUpdated:r.revealed?now:null
        }))
      };
    };
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:{access_token:'test-session'}}}),
        signOut:async()=>({error:null})
      },
      functions:{invoke:async()=>({data:{status:'fresh'},error:null})},
      rpc:async(_method,{action,payload}={})=>{
        const ok=data=>({data,error:null});
        const fail=msg=>({data:null,error:{message:msg}});
        // Mock the separate, owner-authoritative Equipment RPC. The production
        // database also has dedicated transaction and RLS checks.
        if(_method==='rips_equipment_command'){
          backend.equipmentSlots ||= {};
          backend.achievements ||= [];
          backend.visibility ||= {gear:false,badges:false};
          backend.goal ||= 'test_set';
          const choices=mockCatalog.filter(c=>c.ge!=null);
          const defs=choices.map((c,i)=>({
            id:c.id,geId:c.ge,slot:i===0?'weapon':i===1?'legs':
              i===2?'shield':i===3?'feet':'body',twoHanded:false
          }));
          const definition=item=>defs.find(d=>d.id===item);
          const ownedItem=instance=>backend.inventory.find(i=>i.instance===instance&&i.status==='vaulted');
          const equippedArray=()=>Object.entries(backend.equipmentSlots).map(([slot,instance])=>{
            const item=ownedItem(instance),data=item?mockCatalog.find(c=>c.id===item.item):null;
            return item&&data?{slot,instance,item:item.item,geId:data.ge,name:data.name,
              value:data.guide,twoHanded:definition(item.item)?.twoHanded||false}:null;
          }).filter(Boolean);
          const pieces=choices.slice(0,2).map(c=>{
            const asset=backend.inventory.find(i=>i.item===c.id&&i.status==='vaulted');
            const selected=asset?Object.entries(backend.equipmentSlots).find(([k,v])=>v===asset.instance):null;
            return {geId:c.ge,slot:definition(c.id).slot,name:c.name,
              discovered:backend.inventory.some(i=>i.item===c.id),
              owned:Boolean(asset),equipped:Boolean(selected),instance:asset?.instance||null,
              sources:[{case:boss.id,name:boss.name,pack:'boss',price:boss.price,chance:.02}]};
          });
          const makeState=()=>{
            const equipped=equippedArray();
            if(equipped.length&&!backend.achievements.includes('first_equip'))
              backend.achievements.push('first_equip');
            if(pieces.every(p=>p.discovered)&&!backend.achievements.includes('first_set'))
              backend.achievements.push('first_set');
            const achievementName={first_equip:'First Steps',first_set:'Set Collector'};
            const badges=backend.achievements.map(code=>({
              code,title:achievementName[code]||code,description:'Earned by playing.',
              earnedAt:now
            }));
            const set={id:'test_set',name:'Test Starter Kit',tier:'starter',
              description:'Test collection using two real fixture reward items.',
              pieces,required:pieces.length,
              discovered:pieces.filter(p=>p.discovered).length,
              owned:pieces.filter(p=>p.owned).length,
              equipped:pieces.filter(p=>p.equipped).length,
              completed:pieces.every(p=>p.owned),
              historicalComplete:pieces.every(p=>p.discovered),
              fullyEquipped:pieces.every(p=>p.equipped)};
            save();
            return {definitions:defs,slots:equipped,sets:[set],goal:backend.goal,
              achievements:badges,title:backend.titleCode||null,eligibleTitles:badges,visibility:{...backend.visibility}};
          };
          if(action==='showcase'){
            const snapshot=makeState();
            const own=payload?.owner==='11111111-1111-4111-8111-111111111111';
            return ok({name:'Playwright Tester',visibility:{...backend.visibility},
              title:own||backend.visibility.badges?(backend.titleCode?'First Steps':null):null,
              slots:own||backend.visibility.gear?snapshot.slots:[],
              badges:own||backend.visibility.badges?snapshot.achievements:[]});
          }
          if(action==='equip'){
            const asset=ownedItem(payload?.id);
            if(!asset)return fail('This item is not owned or banked.');
            const def=definition(asset.item);
            if(!def)return fail('This item cannot be equipped.');
            if(asset.listing)return fail('Cancel listing first.');
            for(const slot of Object.keys(backend.equipmentSlots))
              if(slot===def.slot||backend.equipmentSlots[slot]===asset.instance)
                delete backend.equipmentSlots[slot];
            if(def.twoHanded)delete backend.equipmentSlots.shield;
            backend.equipmentSlots[def.slot]=asset.instance;
          }
          if(action==='unequip')delete backend.equipmentSlots[payload?.slot];
          if(action==='equip_set'){
            for(const piece of pieces){
              const asset=ownedItem(piece.instance);
              if(asset)backend.equipmentSlots[definition(asset.item).slot]=asset.instance;
            }
          }
          if(action==='goal'){
            if(payload?.set!=='test_set')return fail('Unknown set.');
            backend.goal=payload.set;
          }
          if(action==='visibility'){
            for(const k of ['gear','badges'])if(Object.hasOwn(payload||{},k)){
              if(typeof payload[k]!=='boolean')return fail('Invalid privacy setting.');
              backend.visibility[k]=payload[k];
            }
          }
          if(action==='title'){
            if(payload?.code&&!backend.achievements.includes(payload.code))
              return fail('You have not earned this title.');
            backend.titleCode=payload?.code||null;
          }
          return ok(makeState());
        }
        if(action==='catalog')return ok(mockCatalog);
        if(action==='cases')return ok([boss]);
        if(action==='state')return ok({
          id,name:'Playwright Tester',gp:backend.gp,
          items:backend.inventory.filter(i=>i.status==='vaulted')
            .map(i=>({id:i.instance,item:i.item,pinned:Boolean(i.pinned),protected:Boolean(i.protected),pulled:true,listing:i.listing||null,salvage:0})),
          market:[],pulls:{},nextDailyAt:now,serverTime:now
        });
        if(action==='lock'){
          const owned=backend.inventory.find(i=>i.instance===payload?.id&&i.status==='vaulted');
          if(!owned||owned.listing)return fail('Cannot protect this item.');
          owned.protected=!owned.protected;save();return ok(null);
        }
        if(action==='sell'){
          const owned=backend.inventory.find(i=>i.instance===payload?.id&&i.status==='vaulted');
          if(!owned)return fail('Item not owned');
          if(owned.protected)return fail('Unlock this protected item before selling it.');
          if(owned.listing)return fail('Cancel listing first');
          if(Object.values(backend.equipmentSlots||{}).includes(owned.instance))
            return fail('Unequip before selling.');
          owned.status='sold';
          backend.gp+=mockCatalog.find(c=>c.id===owned.item).guide;
          save();return ok(null);
        }
        if(action==='pin'){
          const owned=backend.inventory.find(i=>i.instance===payload?.id&&i.status==='vaulted');
          if(!owned||owned.listing)return fail('This item cannot be displayed.');
          if(!owned.pinned&&backend.inventory.filter(i=>i.status==='vaulted'&&i.pinned).length>=5)
            return fail('Your showroom is full.');
          owned.pinned=!owned.pinned;
          save();return ok(null);
        }
        if(action==='sell_bulk'){
          const ids=payload?.ids;
          if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)
            return fail('Invalid bulk sale selection');
          const owned=ids.map(id=>backend.inventory.find(i=>i.instance===id && i.status==='vaulted'));
          if(owned.some(item=>!item || item.listing || item.protected||
            Object.values(backend.equipmentSlots||{}).includes(item.instance)))
            return fail('Your selection includes protected, equipped or unavailable items.');
          if(window.__mockRejectBulkSale){
            window.__mockRejectBulkSale=false;
            return fail('Server rejected the sale; inventory unchanged.');
          }
          const total=owned.reduce((sum,item)=>sum+mockCatalog.find(c=>c.id===item.item).guide,0);
          owned.forEach(item=>item.status='sold');
          backend.gp+=total;
          backend.bulkSales=(backend.bulkSales||0)+1;
          save();
          return ok({count:ids.length,total});
        }
        if(action==='reward_batch')return ok(backend.batch &&
          (payload?.batch||backend.batch.rewards.some(r=>r.status==='pending'))?snapshot():null);
        if(action==='case_purchase'){
          const qty=payload?.quantity;
          if(!Number.isInteger(qty)||qty<1||qty>5)return fail('Invalid quantity');
          if(backend.batch?.rewards.some(r=>r.status==='pending'))return fail('Previous rewards pending');
          const cost=boss.price*qty;
          if(cost>backend.gp)return fail('Not enough GP');
          backend.gp-=cost;backend.purchases++;
          backend.batch={id:payload.request,case:boss.id,quantity:qty,paid:cost,
            rewards:Array.from({length:qty},(_,i)=>{
              const item=mockCatalog[i].id,instance=id.slice(0,-1)+(i+1);
              backend.inventory.push({instance,item,status:'pending'});
              return {slot:i+1,item,instance,status:'pending',revealed:false};
            })
          };
          save();
          return ok(snapshot());
        }
        if(action==='reward_reveal'){
          if(!backend.batch||payload?.batch!==backend.batch.id)return fail('Invalid batch');
          for(const r of backend.batch.rewards){
            if(payload.slot==null||payload.slot===r.slot)r.revealed=true;
          }
          save();
          return ok(snapshot());
        }
        if(action==='reward_settle'){
          if(!backend.batch||payload?.batch!==backend.batch.id)return fail('Unknown batch');
          const slots=payload.slots,decision=payload.decision;
          if(!Array.isArray(slots)||!['sell','vault'].includes(decision))return fail('Invalid action');
          const rewards=slots.map(n=>backend.batch.rewards.find(r=>r.slot===n));
          if(rewards.some(r=>!r||r.status!=='pending'||!r.revealed))return fail('Already settled');
          backend.settlements++;
          for(const r of rewards){
            r.status=decision==='sell'?'sold':'vaulted';
            const found=backend.inventory.find(x=>x.instance===r.instance);
            found.status=r.status;
            if(decision==='sell'){
              r.settledValue=mockCatalog.find(c=>c.id===r.item).guide;
              backend.gp+=r.settledValue;
            }
          }
          save();return ok(snapshot());
        }
        return ok(null);
      }
    })};
  },{mockCatalog:testCatalog,boss:testCase,gp});
  await page.goto('/');
  await expect(page.locator('#games [data-act="game"][data-id="runescape"]')).toBeVisible();
  await page.locator('#games [data-act="game"][data-id="runescape"]').click();
  await expect(page.locator('#shop .premium-category')).toHaveCount(3);
  await page.locator('#shop [data-act="category"][data-id="boss"]').click();
  await expect(page.locator('#shop.boss-shop .boss-carousel')).toBeVisible();
  await expect(page.locator('#boss-details h2')).toHaveText('Starter Loot');
  return errors;
}
async function ripPack(page,from=.12,to=.90){
  const handle=page.locator('#cr-reveal .cr-rip-target');
  await expect(handle).toBeVisible();
  await handle.evaluate(el=>Promise.all(el.parentElement.getAnimations().map(a=>a.finished.catch(()=>{}))));
  const rect=await handle.boundingBox();
  const y=rect.y+rect.height*.48;
  await page.mouse.move(rect.x+rect.width*from,y);
  await page.mouse.down();
  await page.mouse.move(rect.x+rect.width*to,y,{steps:10});
  await page.mouse.up();
}
async function purchase(page,qty){
  await page.locator('.boss-qty [data-id="'+qty+'"]').click();
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('#cr-reveal')).toBeVisible();
  await ripPack(page);
}
async function revealAll(page,qty){
  await expect(page.locator('#cr-reveal .cr-turn')).toHaveCount(qty);
  await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
  await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(qty);
}

test('enough GP with pending rewards offers Resume Opening instead of a disabled purchase',async({page})=>{
  const errors=await setup(page,{gp:2000,viewport:{width:375,height:812}});
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('.cr-opening')).toBeVisible();
  await expect(page.locator('#gp-wallet-live .gp-wallet-total')).toHaveText('1,000 GP');
  await page.locator('#cr-reveal [data-cr="back"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  const resume=page.locator('#boss-details [data-act="resume"]');
  await expect(resume).toBeVisible();
  await expect(resume).toBeEnabled();
  await expect(resume).toHaveText('Resume Opening');
  await expect(resume).toHaveClass(/boss-open/);
  await expect(page.locator('#boss-details [data-act="purchase"]')).toHaveCount(0);
  await expect(page.locator('.boss-warning')).toHaveCount(0);
  await resume.click();
  await expect(page.locator('.cr-opening')).toBeVisible();
  expect((await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')))).purchases).toBe(1);
  await ripPack(page);
  await expect(page.locator('.cr-single-name')).toHaveText('Rune scimitar');
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await expect(page.locator('#boss-details [data-act="purchase"]')).toBeEnabled();
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('.cr-opening')).toBeVisible();
  const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(backend.purchases).toBe(2);
  expect(backend.gp).toBe(0);
  await ripPack(page);
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('resume previous opening remains available even if GP has fallen below pack price',async({page})=>{
  const errors=await setup(page,{gp:1000});
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('.cr-opening')).toBeVisible();
  await page.locator('#cr-reveal [data-cr="back"]').click();
  await expect(page.locator('#balance')).toHaveText('0 GP');
  await expect(page.locator('#boss-details [data-act="resume"]')).toBeEnabled();
  await expect(page.locator('#boss-details [data-act="purchase"]')).toHaveCount(0);
  await page.locator('#boss-details [data-act="resume"]').click();
  await expect(page.locator('.cr-opening')).toBeVisible();
  await ripPack(page);
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await expect(page.locator('#boss-details [data-act="purchase"]')).toBeDisabled();
  expect(errors).toEqual([]);
});
test('pack stays sealed until a real horizontal swipe completes',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await page.locator('.boss-qty [data-id="1"]').click();
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('.cr-opening')).toBeVisible();
  await expect(page.locator('.cr-rip-target')).toBeVisible();
  await expect(page.locator('[data-cr="skip"]')).toHaveCount(0);
  await page.waitForTimeout(2200);
  await expect(page.locator('.cr-opening')).toBeVisible();
  await page.locator('.cr-rip-target').click();
  await expect(page.locator('.cr-opening')).toBeVisible();
  await ripPack(page,.15,.38);
  await expect(page.locator('.cr-opening')).toBeVisible();
  expect(await page.locator('#cr-reveal').evaluate(el=>el.style.getPropertyValue('--cr-rip-progress'))).toBe('0');
  const before=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(before.batch.rewards[0].revealed).toBe(false);
  await ripPack(page);
  await expect(page.locator('.cr-single-name')).toHaveText('Rune scimitar');
  const after=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(after.purchases).toBe(1);
  expect(after.gp).toBe(99000);
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('unopened pack shows only artwork and chrome, never helper notes',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await page.locator('#boss-details [data-act="purchase"]').click();
  const opening=page.locator('.cr-opening');
  await expect(opening).toBeVisible();
  await expect(opening.locator('.cr-pack-piece .boss-foil')).toHaveCount(1);
  await expect(opening.locator('.cr-rip-assembly .cr-rip-flap')).toHaveCount(1);
  await expect(opening.locator('.cr-rip-assembly .cr-rip-light')).toHaveCount(1);
  await expect(page.locator('.cr-progress,.cr-opening-title,.cr-opening-note,.cr-swipe-cue,.cr-deck-help')).toHaveCount(0);
  const visible=await page.locator('#cr-reveal').innerText();
  for(const text of ['SWIPE TO RIP','Rewards were securely selected','Swipe across the pack','Tap to speed up']){
    expect(visible).not.toContain(text);
  }
  await ripPack(page);
  await expect(page.locator('.cr-single-name')).toHaveText('Rune scimitar');
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('swipe light follows a reverse drag and physically peels the foil',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await page.locator('#boss-details [data-act="purchase"]').click();
  const handle=page.locator('.cr-rip-target');
  await handle.evaluate(el=>Promise.all(el.parentElement.getAnimations().map(a=>a.finished.catch(()=>{}))));
  const box=await handle.boundingBox();
  const y=box.y+box.height*.45;
  await page.mouse.move(box.x+box.width*.84,y);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width*.38,y,{steps:8});
  const swipe=await page.locator('#cr-reveal').evaluate(el=>({
    direction:el.classList.contains('cr-rip-reverse'),
    progress:Number(el.style.getPropertyValue('--cr-rip-progress')),
    lightX:el.style.getPropertyValue('--cr-rip-light-x'),
    lightOpacity:getComputedStyle(el.querySelector('.cr-rip-light')).opacity
  }));
  expect(swipe.direction).toBe(true);
  expect(swipe.progress).toBeGreaterThan(.5);
  expect(parseFloat(swipe.lightX)).toBeGreaterThan(2);
  expect(swipe.lightOpacity).toBe('1');
  await page.mouse.move(box.x+box.width*.12,y,{steps:6});
  await page.mouse.up();
  await expect(page.locator('.cr-opening.cr-ripped')).toBeVisible();
  await expect(page.locator('.cr-opening.cr-ripped .cr-rip-flap')).toHaveCSS('animation-name','cr-foil-peel');
  await expect(page.locator('.cr-single-name')).toHaveText('Rune scimitar');
  const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(backend.purchases).toBe(1);
  expect(backend.gp).toBe(99000);
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('keyboard activation is an accessible alternative to the swipe',async({page})=>{
  const errors=await setup(page);
  await page.locator('.boss-qty [data-id="1"]').click();
  await page.locator('#boss-details [data-act="purchase"]').click();
  await page.locator('.cr-rip-target').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cr-single-name')).toHaveText('Rune scimitar');
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('multi-pack reveal keeps every stage fully opaque with no phase fade',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await purchase(page,3);
  await expect(page.locator('#cr-reveal')).toHaveClass(/cr-multi-batch/);
  await expect(page.locator('#cr-reveal')).toHaveCSS('animation-name','none');
  await expect(page.locator('#cr-reveal .cr-stage')).not.toHaveClass(/cr-phase-enter/);
  await revealAll(page,3);
  await expect(page.locator('.cr-results')).not.toHaveClass(/cr-phase-enter/);
  await expect(page.locator('.cr-results')).toHaveCSS('opacity','1');
  await page.locator('.cr-result-card').first().click();
  await expect(page.locator('.cr-result-card[aria-pressed="true"]')).toHaveCount(1);
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('single opening presents dominant item, exact GP and Sell/Bank',async({page})=>{
  const errors=await setup(page);
  await purchase(page,1);
  await expect(page.locator('.cr-single-name')).toHaveText('Rune scimitar');
  await expect(page.locator('.cr-single-info')).toContainText('12,000 GP');
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  await page.locator('nav.tabs [data-view="inventory"]').click();
  await expect(page.locator('#owned')).toContainText('Rune scimitar');
  expect(errors).toEqual([]);
});
for(const qty of [2,3,5]){
  test(qty+' packs generate '+qty+' facedown cards then result grid',async({page})=>{
    const errors=await setup(page);
    await purchase(page,qty);
    await revealAll(page,qty);
    await expect(page.locator('.cr-summary-label')).toContainText(qty+' items');
    await page.locator('[data-cr="vault"]').click();
    await expect(page.locator('#cr-reveal')).toBeHidden();
    const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
    expect(backend.batch.rewards).toHaveLength(qty);
    expect(backend.batch.rewards.every(r=>r.status==='vaulted')).toBe(true);
    expect(errors).toEqual([]);
  });
}
for(const viewport of [{width:1280,height:850},{width:375,height:812}]){
  test('four-pack flips keep the entire scene and previous cards mounted ('+viewport.width+'px)',async({page})=>{
    const errors=await setup(page,{viewport});
    await purchase(page,4);
    await expect(page.locator('.cr-turn')).toHaveCount(4);
    await page.evaluate(()=>{
      window.__steadyReveal={
        background:document.querySelector('#cr-reveal .cr-sky'),
        glow:document.querySelector('#cr-reveal .cr-light'),
        shell:document.querySelector('#cr-reveal .cr-shell'),
        stage:document.querySelector('#cr-reveal .cr-stage'),
        deck:document.querySelector('#cr-reveal .cr-deck'),
        cards:[...document.querySelectorAll('#cr-reveal .cr-turn')]
      };
    });
    // The first three flips must not replace the other cards, animated sky
    // or backdrop. That full DOM replacement caused the repeated screen flash.
    for(let slot=1;slot<=3;slot++){
      await page.locator('.cr-turn[data-slot="'+slot+'"]').click();
      await expect(page.locator('.cr-turn[data-slot="'+slot+'"]')).toHaveClass(/cr-flipped/);
      await expect(page.locator('.cr-turn[data-slot="'+slot+'"] .cr-card-front h3')).toBeVisible();
      const stability=await page.evaluate(()=>{
        const old=window.__steadyReveal;
        return {
          background:document.querySelector('#cr-reveal .cr-sky')===old.background,
          glow:document.querySelector('#cr-reveal .cr-light')===old.glow,
          shell:document.querySelector('#cr-reveal .cr-shell')===old.shell,
          stage:document.querySelector('#cr-reveal .cr-stage')===old.stage,
          deck:document.querySelector('#cr-reveal .cr-deck')===old.deck,
          cards:old.cards.every((node,index)=>document.querySelectorAll('#cr-reveal .cr-turn')[index]===node),
          flipped:document.querySelectorAll('#cr-reveal .cr-turn.cr-flipped').length
        };
      });
      expect(stability).toMatchObject({
        background:true,glow:true,shell:true,stage:true,deck:true,cards:true,flipped:slot
      });
      await expect(page.locator('.cr-turn')).toHaveCount(4);
    }
    await page.locator('.cr-turn[data-slot="4"]').click();
    await expect(page.locator('.cr-turn[data-slot="4"]')).toHaveClass(/cr-flipped/);
    await expect(page.locator('.cr-result-card')).toHaveCount(4);
    await page.locator('[data-cr="vault"]').click();
    await expect(page.locator('#cr-reveal')).toBeHidden();
    const record=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
    expect(record.purchases).toBe(1);
    expect(record.batch.rewards.every(r=>r.revealed&&r.status==='vaulted')).toBe(true);
    expect(errors).toEqual([]);
  });
}
test('Reveal all preserves the existing scene while every card flips',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await purchase(page,5);
  await page.locator('.cr-turn[data-slot="1"]').click();
  await expect(page.locator('.cr-turn[data-slot="1"]')).toHaveClass(/cr-flipped/);
  await page.evaluate(()=>{
    window.__steadyBatch={
      background:document.querySelector('#cr-reveal .cr-sky'),
      cards:[...document.querySelectorAll('#cr-reveal .cr-turn')]
    };
  });
  await page.locator('[data-cr="reveal-all"]').click();
  await expect(page.locator('.cr-turn.cr-flipped')).toHaveCount(5);
  const sameNodes=await page.evaluate(()=>{
    const old=window.__steadyBatch;
    return document.querySelector('#cr-reveal .cr-sky')===old.background &&
      old.cards.every((card,index)=>document.querySelectorAll('#cr-reveal .cr-turn')[index]===card);
  });
  expect(sameNodes).toBe(true);
  await expect(page.locator('.cr-result-card')).toHaveCount(5);
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});

test('selecting multi-pack rewards never remounts the scene or previously revealed cards',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await purchase(page,4);
  await revealAll(page,4);
  await page.evaluate(()=>{
    window.__resultNodes={
      sky:document.querySelector('#cr-reveal .cr-sky'),
      light:document.querySelector('#cr-reveal .cr-light'),
      stage:document.querySelector('#cr-reveal .cr-results'),
      cards:[...document.querySelectorAll('#cr-reveal .cr-result-card')]
    };
  });
  for(const [position,summary,total] of [
    [0,'1 / 4 items selected','12,000 GP'],
    [1,'2 / 4 items selected','34,000 GP'],
    [0,'1 / 4 items selected','22,000 GP']
  ]){
    await page.locator('.cr-result-card').nth(position).click();
    await expect(page.locator('.cr-summary-label')).toHaveText(summary);
    await expect(page.locator('.cr-summary-value')).toHaveText(total);
    const stable=await page.evaluate(()=>{
      const nodes=window.__resultNodes;
      return document.querySelector('#cr-reveal .cr-sky')===nodes.sky &&
        document.querySelector('#cr-reveal .cr-light')===nodes.light &&
        document.querySelector('#cr-reveal .cr-results')===nodes.stage &&
        nodes.cards.every((node,index)=>document.querySelectorAll('#cr-reveal .cr-result-card')[index]===node);
    });
    expect(stable).toBe(true);
    await expect(page.locator('.cr-results')).not.toHaveClass(/cr-phase-enter/);
  }
  await expect(page.locator('[data-cr="vault"]')).toHaveText('BANK (1)');
  await page.locator('[data-cr="vault"]').click();
  await expect(page.locator('.cr-result-card')).toHaveCount(3);
  await page.locator('[data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('four-packs: select 2, sell only selected, vault the rest atomically',async({page})=>{
  const errors=await setup(page);
  await purchase(page,4);
  await revealAll(page,4);
  await page.locator('.cr-result-card').nth(0).click();
  await page.locator('.cr-result-card').nth(1).click();
  await expect(page.locator('.cr-summary-label')).toHaveText('2 / 4 items selected');
  await expect(page.locator('.cr-summary-value')).toHaveText('34,000 GP');
  await expect(page.locator('[data-cr="sell"]')).toContainText('SELL (2)');
  await expect(page.locator('.cr-result-card[aria-pressed="true"]')).toHaveCount(2);
  await page.locator('[data-cr="sell"]').click();
  await expect(page.locator('.cr-result-card')).toHaveCount(2);
  await expect(page.locator('[data-cr="vault"]')).toContainText('BANK ALL');
  await page.locator('[data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(backend.gp).toBe(100000-4000+12000+22000);
  expect(backend.settlements).toBe(2);
  expect(backend.batch.rewards.map(r=>r.status)).toEqual(['sold','sold','vaulted','vaulted']);
  expect(errors).toEqual([]);
});
test('reload during uncompleted reveal resumes without new purchase',async({page})=>{
  const errors=await setup(page);
  await purchase(page,3);
  await page.locator('.cr-turn').first().click();
  await expect(page.locator('.cr-turn').first()).toHaveClass(/cr-flipped/);
  await page.reload();
  await page.locator('#games [data-act="game"][data-id="runescape"]').click();
  await page.locator('#shop [data-act="category"][data-id="boss"]').click();
  await expect(page.locator('[data-act="resume"]')).toBeVisible();
  await page.locator('[data-act="resume"]').first().click();
  await expect(page.locator('.cr-turn')).toHaveCount(3);
  await expect(page.locator('.cr-turn').first()).toHaveClass(/cr-flipped/);
  await page.locator('[data-cr="reveal-all"]').click();
  await expect(page.locator('.cr-result-card')).toHaveCount(3);
  await page.locator('[data-cr="vault"]').click();
  const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(backend.purchases).toBe(1);
  expect(errors).toEqual([]);
});
test('mobile results remain two-column, safe-area actions and no sideways overflow',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await purchase(page,4);
  await revealAll(page,4);
  const columns=await page.locator('.cr-results-grid').evaluate(el=>
    getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
  const bodyWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(376);
  await expect(page.locator('.cr-actions')).toBeInViewport();
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('five-item mobile results keep the GP wallet above the summary and minimize scrolling',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:740}});
  await purchase(page,5);
  await revealAll(page,5);
  await expect(page.locator('#gp-wallet-live')).toBeVisible();
  // Even while a GP credit/debit message is visible, it must not cover the total.
  await page.locator('#gp-wallet-live .gp-wallet-change').evaluate(node=>{
    node.textContent='+12,000 GP';
    node.hidden=false;
  });
  const layout=await page.evaluate(()=>{
    const wallet=document.getElementById('gp-wallet-live').getBoundingClientRect();
    const summary=document.querySelector('.cr-summary').getBoundingClientRect();
    const art=document.querySelector('.cr-result-art').getBoundingClientRect();
    const results=document.querySelector('.cr-results-scroll');
    return {
      walletBottom:wallet.bottom,
      summaryTop:summary.top,
      artHeight:art.height,
      scrollOverhang:results.scrollHeight-results.clientHeight
    };
  });
  expect(layout.walletBottom).toBeLessThanOrEqual(layout.summaryTop);
  expect(layout.artHeight).toBeLessThanOrEqual(133);
  expect(layout.scrollOverhang).toBeLessThanOrEqual(165);
  await expect(page.locator('.cr-actions')).toBeInViewport();
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('inventory and showroom display authentic OSRS icons and no market or listing option',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await expect(page.locator('[data-view="market"]')).toHaveCount(0);
  await expect(page.locator('[data-view="showcase"]')).toHaveText('Showroom');
  await purchase(page,2);
  await revealAll(page,2);
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await page.locator('[data-view="inventory"]').click();
  await expect(page.locator('#owned .item-icon')).toHaveCount(2);
  await expect(page.locator('#owned .item-icon').first()).toHaveAttribute(
    'src','https://static.runelite.net/cache/item/icon/1115.png');
  await expect(page.locator('#owned .item-icon').first()).toBeVisible();
  await expect(page.locator('#owned [data-act="list"]')).toHaveCount(0);
  await expect(page.locator('#owned [data-act="pin"]')).toHaveCount(2);
  await page.locator('#owned [data-act="pin"]').first().click();
  await page.locator('[data-view="showcase"]').click();
  await expect(page.locator('#pins .item-icon')).toHaveCount(1);
  await expect(page.locator('#pins .item-icon')).toHaveAttribute(
    'src','https://static.runelite.net/cache/item/icon/1115.png');
  await expect(page.locator('#pins .item-icon')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Sell All credits validated server prices exactly once',async({page})=>{
  const errors=await setup(page);
  await purchase(page,2);
  await revealAll(page,2);
  await page.locator('[data-cr="sell"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  const before=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(before.gp).toBe(100000-2000+12000+22000);
  expect(before.settlements).toBe(1);
  await page.reload();
  const after=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(after.gp).toBe(before.gp);
  expect(after.purchases).toBe(1);
  expect(after.settlements).toBe(1);
  expect(errors).toEqual([]);
});


test('pack purchase shows red real-balance debit, single sale shows green server-credit',async({page})=>{
 const errors=await setup(page);
 await expect(page.locator('#balance')).toHaveText('100,000 GP');
 await page.locator('.boss-qty [data-id="1"]').click();
 await page.locator('#boss-details [data-act="purchase"]').click();
 await expect(page.locator('#cr-reveal')).toBeVisible();
 await expect(page.locator('#balance')).toHaveText('99,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveText('−1,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveClass(/gp-negative/);
 await expect(page.locator('#gp-wallet-live')).toContainText('99,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveText('−1,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveClass(/gp-negative/);
 await ripPack(page);
 await expect(page.locator('.cr-single-info')).toContainText('12,000 GP');
 await page.locator('[data-cr="sell"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 await expect(page.locator('#balance')).toHaveText('111,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveText('+12,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveClass(/gp-positive/);
 expect(errors).toEqual([]);
});
test('multi-pack purchase debits total and selected sale credits only selected verified rewards',async({page})=>{
 const errors=await setup(page);
 await purchase(page,4);
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveText('−4,000 GP');
 await expect(page.locator('#balance')).toHaveText('96,000 GP');
 await revealAll(page,4);
 await page.locator('.cr-result-card').nth(0).click();
 await page.locator('.cr-result-card').nth(1).click();
 await page.locator('[data-cr="sell"]').click();
 await expect(page.locator('.cr-result-card')).toHaveCount(2);
 await expect(page.locator('#balance')).toHaveText('130,000 GP');
 await expect(page.locator('#gp-wallet-live')).toContainText('130,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveText('+34,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveClass(/gp-positive/);
 await page.locator('[data-cr="vault"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 await expect(page.locator('#gp-delta-inline')).toHaveText('+34,000 GP');
 expect(errors).toEqual([]);
});
test('no debit or credit animation on insufficient GP / unsuccessful pack purchase',async({page})=>{
 const errors=await setup(page,{gp:500});
 await expect(page.locator('#balance')).toHaveText('500 GP');
 await expect(page.locator('#boss-details [data-act="purchase"]')).toBeDisabled();
 await expect(page.locator('#gp-delta-inline')).toBeHidden();
 expect(errors).toEqual([]);
});


async function prepareInventory(page,qty=4){
 await purchase(page,qty);
 await revealAll(page,qty);
 await page.locator('[data-cr="vault"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 await page.locator('nav.tabs [data-view="inventory"]').click();
 await expect(page.locator('#owned .item')).toHaveCount(qty);
}

test('Inventory multi-select sells only chosen items at confirmed GE prices and credits GP once',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,4);
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#inventory-toolbar')).toBeVisible();
 await page.locator('#owned [data-act="inventory-toggle"]').nth(0).click();
 await page.locator('#owned [data-act="inventory-toggle"]').nth(1).click();
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(2);
 await expect(page.locator('#inventory-toolbar')).toContainText('2 selected');
 await expect(page.locator('#inventory-toolbar')).toContainText('34,000 GP');
 await expect(page.locator('#inventory-toolbar [data-act="inventory-sell"]')).toContainText('Sell selected (2)');
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
 await expect(page.locator('#owned .item')).toHaveCount(2);
 await expect(page.locator('#balance')).toHaveText('130,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveText('+34,000 GP');
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(0);
 const result=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(result.bulkSales).toBe(1);
 expect(result.inventory.filter(i=>i.status==='sold')).toHaveLength(2);
 expect(result.inventory.filter(i=>i.status==='vaulted')).toHaveLength(2);
 expect(errors).toEqual([]);
});
test('Select all, clear and selection mode preserve individual inventory actions',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,3);
 await page.locator('#inventory-mode-button').click();
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#owned .is-selected')).toHaveCount(3);
 await expect(page.locator('#inventory-toolbar')).toContainText('70,000 GP');
 await page.locator('#inventory-toolbar [data-act="inventory-clear"]').click();
 await expect(page.locator('#owned .is-selected')).toHaveCount(0);
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#inventory-toolbar')).toBeHidden();
 await expect(page.locator('#owned [data-act="sell"]')).toHaveCount(3);
 expect(errors).toEqual([]);
});
test('Listed inventory items cannot be selected for bulk sale',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,3);
 await page.evaluate(()=>{
   const backend=JSON.parse(sessionStorage.getItem('reveal-mock'));
   backend.inventory[0].listing='11111111-1111-4111-8111-111111111199';
   sessionStorage.setItem('reveal-mock',JSON.stringify(backend));
 });
 await page.reload();
 await page.locator('#games [data-act="game"][data-id="runescape"]').click();
 await page.locator('nav.tabs [data-view="inventory"]').click();
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#owned .inventory-entry.is-unavailable')).toHaveCount(1);
 await expect(page.locator('#owned .inventory-select-overlay')).toHaveCount(2);
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#owned .is-selected')).toHaveCount(2);
 await expect(page.locator('#inventory-toolbar')).toContainText('58,000 GP');
 expect(errors).toEqual([]);
});
test('Failed atomic bulk sale does not deduct items or change GP, and retry succeeds',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,2);
 await page.locator('#inventory-mode-button').click();
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await page.evaluate(()=>{window.__mockRejectBulkSale=true;});
 page.on('dialog',d=>d.accept());
 await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
 await expect(page.locator('#status')).toContainText('Server rejected the sale');
 await expect(page.locator('#balance')).toHaveText('98,000 GP');
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(2);
 await expect(page.locator('#owned .item')).toHaveCount(2);
 await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
 await expect(page.locator('#balance')).toHaveText('132,000 GP');
 await expect(page.locator('#owned .item')).toHaveCount(0);
 const result=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(result.bulkSales).toBe(1);
 expect(errors).toEqual([]);
});
test('Inventory multi-select works on a phone width without horizontal overflow',async({page})=>{
 const errors=await setup(page,{viewport:{width:375,height:812}});
 await prepareInventory(page,5);
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#inventory-toolbar [data-act="inventory-all"]')).toBeVisible();
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#inventory-toolbar')).toContainText('5 selected');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
 expect(errors).toEqual([]);
});


test('Inventory shows only value and total item cards without changing GP',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,4);
 const dash=page.locator('#inventory-overview');
 await expect(dash).toContainText('119,000 GP');
 await expect(dash).toContainText('4 unique types');
 await expect(dash.locator('.inventory-stat')).toHaveCount(2);
 await expect(dash).not.toContainText('Extra copies');
 await expect(dash).not.toContainText('Most valuable item');
 await expect(page.locator('#balance')).toHaveText('96,000 GP');
 expect(errors).toEqual([]);
});
test('Inventory live search, value sorting and category filters retain original items',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,4);
 await page.locator('#inventory-sort').selectOption('value-high');
 await expect(page.locator('#owned .item h3').first()).toHaveText('Dragon boots');
 await page.locator('#inventory-sort').selectOption('value-low');
 await expect(page.locator('#owned .item h3').first()).toHaveText('Rune scimitar');
 await page.locator('#inventory-search').fill('abyssal');
 await expect(page.locator('#owned .item')).toHaveCount(1);
 await expect(page.locator('#inventory-results')).toContainText('Showing 1 of 4');
 await expect(page.locator('#owned')).toContainText('Abyssal whip');
 await page.locator('#inventory-search').fill('');
 await page.locator('#inventory-filter').selectOption('sellable');
 await expect(page.locator('#owned .item')).toHaveCount(4);
 await page.locator('#inventory-filter').selectOption('pets');
 await expect(page.locator('#owned .item')).toHaveCount(0);
 await page.locator('#inventory-filter').selectOption('all');
 await expect(page.locator('#owned .item')).toHaveCount(4);
 const mock=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(mock.inventory.filter(i=>i.status==='vaulted')).toHaveLength(4);
 expect(errors).toEqual([]);
});
test('Protected inventory blocks individual and bulk sales, and unlock restores eligibility',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,3);
 const lock=page.locator('#owned [data-act="inventory-lock"]').first();
 await lock.click();
 await expect(page.locator('#owned .inventory-protected')).toHaveCount(1);
 await expect(page.locator('#owned .inventory-protected-tag')).toHaveCount(1);
 await page.locator('#inventory-filter').selectOption('protected');
 await expect(page.locator('#owned .item')).toHaveCount(1);
 await page.locator('#inventory-filter').selectOption('all');
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#owned .inventory-entry.is-unavailable')).toHaveCount(1);
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(2);
 const protectedID=await page.evaluate(()=>{
   const backend=JSON.parse(sessionStorage.getItem('reveal-mock'));
   return backend.inventory.find(i=>i.protected).instance;
 });
 const rpcBlocked=await page.evaluate(async id=>{
   const api=window.supabase.createClient();
   return Promise.all([
     api.rpc('rips_command',{action:'sell',payload:{id}}),
     api.rpc('rips_command',{action:'sell_bulk',payload:{ids:[id]}})
   ]);
 },protectedID);
 expect(rpcBlocked.every(response=>/protected/i.test(response.error?.message||''))).toBe(true);
 await expect(page.locator('#balance')).toHaveText('97,000 GP');
 await page.locator('#inventory-mode-button').click();
 await page.locator('#owned .inventory-protected [data-act="inventory-lock"]').click();
 await expect(page.locator('#owned .inventory-protected')).toHaveCount(0);
 await page.locator('#inventory-mode-button').click();
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(3);
 expect(errors).toEqual([]);
});
test('Duplicate stacking, expansion and select-spares sell extra copies while preserving one',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,4);
 await page.evaluate(()=>{
   const backend=JSON.parse(sessionStorage.getItem('reveal-mock'));
   backend.inventory[1].item=backend.inventory[0].item;
   sessionStorage.setItem('reveal-mock',JSON.stringify(backend));
 });
 await page.reload();
 await page.locator('#games [data-act="game"][data-id="runescape"]').click();
 await page.locator('nav.tabs [data-view="inventory"]').click();
 await expect(page.locator('#inventory-overview')).toContainText('1');
 await expect(page.locator('#inventory-overview')).toContainText('3 unique types');
 await page.locator('#inventory-group').check();
 await expect(page.locator('#owned .inventory-stack')).toHaveCount(1);
 await expect(page.locator('#owned .inventory-stack-count')).toHaveText('×2');
 await page.locator('#owned [data-act="inventory-expand"]').click();
 await expect(page.locator('#owned .inventory-stack-copies .item')).toHaveCount(2);
 await page.getByRole('button',{name:'Select spare duplicates'}).first().click();
 await expect(page.locator('#inventory-toolbar')).toContainText('1 selected');
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(1);
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
 await expect(page.locator('#owned .item')).toHaveCount(3);
 await expect(page.locator('#balance')).toHaveText('108,000 GP');
 const result=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(result.inventory.filter(i=>i.status==='vaulted')).toHaveLength(3);
 expect(result.inventory.filter(i=>i.status==='vaulted'&&i.item==='test_item_0')).toHaveLength(1);
 expect(errors).toEqual([]);
});
test('Step 5 inventory fits a small phone with value cards and filters',async({page})=>{
 const errors=await setup(page,{viewport:{width:375,height:812}});
 await prepareInventory(page,5);
 await expect(page.locator('#inventory-overview .inventory-stat')).toHaveCount(2);
 await expect(page.locator('#inventory-search')).toBeVisible();
 await page.locator('#inventory-group').check();
 await expect(page.locator('#inventory-results')).toContainText('Showing 5 of 5');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
 expect(errors).toEqual([]);
});

test('nontradeable Abyssal orphan shows real OSRS art and sells for 5 million assigned GP',async({page})=>{
  const errors=await setup(page,{customPet:true,gp:100000});
  await purchase(page,1);
  await expect(page.locator('#cr-reveal .cr-single-art img')).toHaveAttribute(
    'src','https://static.runelite.net/cache/item/icon/13262.png');
  await expect(page.locator('#cr-reveal [data-cr="sell"]')).toBeEnabled();
  await page.locator('#cr-reveal [data-cr="sell"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  const first=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(first.gp).toBe(100000-1000+5000000);
  expect(first.batch.rewards[0].settledValue).toBe(5000000);
  await page.reload();
  const next=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(next.gp).toBe(first.gp);
  expect(errors).toEqual([]);
});

test('assigned-value pet can be vaulted and later sold via inventory bulk selection',async({page})=>{
  const errors=await setup(page,{customPet:true,gp:100000});
  await purchase(page,1);
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  await page.locator('nav.tabs [data-view="inventory"]').click();
  await expect(page.locator('#owned .item')).toHaveCount(1);
  await expect(page.locator('#owned .item-icon')).toHaveAttribute(
    'src','https://static.runelite.net/cache/item/icon/13262.png');
  await page.locator('#inventory-mode-button').click();
  await expect(page.locator('#owned [data-act="inventory-toggle"]')).toHaveCount(1);
  await page.locator('#owned [data-act="inventory-toggle"]').click();
  await expect(page.locator('#inventory-toolbar')).toContainText('5,000,000 GP');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
  await expect(page.locator('#owned .item')).toHaveCount(0);
  const result=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(result.gp).toBe(100000-1000+5000000);
  expect(result.bulkSales).toBe(1);
  expect(errors).toEqual([]);
});

test('pet catalog images and category fallbacks respect custom-value selling rules',async({page})=>{
  await setup(page);
  const art=await page.evaluate(()=>{
    const pet={id:'pets_vorki',name:'Vorki',pack:'pets',ge:null,guide:5000000,guideTime:null};
    const generic={...pet,name:'Cats'};
    const nonPet={...pet,pack:'boss'};
    return {
      url:window.ChallengerArtwork.src(pet),
      eligible:window.ChallengerArtwork.saleable(pet),
      genericFallback:window.ChallengerArtwork.fallback(generic),
      genericIcon:window.ChallengerArtwork.src(generic),
      nonPetEligible:window.ChallengerArtwork.saleable(nonPet)
    };
  });
  expect(art.url).toBe('https://static.runelite.net/cache/item/icon/21992.png');
  expect(art.eligible).toBe(true);
  expect(art.genericFallback).toBe('🐈');
  expect(art.genericIcon).toBe('');
  expect(art.nonPetEligible).toBe(false);
});

test('hero removes promotional subtitle and duplicate daily timer while Earn GP remains',async({page})=>{
  const errors=await setup(page);
  await expect(page.locator('.hero')).not.toContainText('Spend GP on packs');
  await expect(page.locator('#daily-timer')).toHaveCount(0);
  await page.getByRole('button',{name:'Earn GP'}).click();
  await expect(page.locator('#earn-dashboard')).toBeVisible();
  expect(errors).toEqual([]);
});

test('34-hour verified GE quote enables direct inventory sale with age disclosure',async({page})=>{
  const errors=await setup(page,{staleGeHours:34});
  await prepareInventory(page,1);
  await expect(page.locator('#owned')).toContainText('older verified quote');
  await expect(page.locator('#owned [data-act="sell"]')).toHaveCount(1);
  await expect(page.locator('#owned [data-act="sell"]')).toContainText('Sell at last GE quote');
  page.once('dialog',dialog=>{
    expect(dialog.message()).toContain('older than 24 hours');
    dialog.accept();
  });
  await page.locator('#owned [data-act="sell"]').click();
  await expect(page.locator('#owned .item')).toHaveCount(0);
  await expect(page.locator('#balance')).toHaveText('111,000 GP');
  expect(errors).toEqual([]);
});

test('GE quote older than 72 hours hides Sell and offers a refresh control',async({page})=>{
  const errors=await setup(page,{staleGeHours:80});
  await prepareInventory(page,1);
  await expect(page.locator('#owned')).toContainText('expired quote');
  await expect(page.locator('#owned [data-act="sell"]')).toHaveCount(0);
  await expect(page.locator('#owned [data-act="inventory-refresh"]')).toHaveCount(1);
  await page.locator('#inventory-mode-button').click();
  await expect(page.locator('#owned [data-act="inventory-toggle"]')).toHaveCount(0);
  await expect(page.locator('#owned .inventory-item-unavailable')).toContainText('Verified GE quote expired');
  expect(errors).toEqual([]);
});


for(const viewport of [{width:1680,height:900},{width:1280,height:720},{width:1024,height:600}]){
  test('desktop five-card hand and Reveal All fit without scrolling at '+viewport.width+'x'+viewport.height,async({page})=>{
    const errors=await setup(page,{viewport});
    await purchase(page,5);
    await expect(page.locator('#cr-reveal .cr-turn')).toHaveCount(5);
    await expect(page.locator('#cr-reveal [data-cr="reveal-all"]')).toBeVisible();
    const layout=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('#cr-reveal .cr-turn')].map(el=>el.getBoundingClientRect());
      const action=document.querySelector('#cr-reveal [data-cr="reveal-all"]').getBoundingClientRect();
      const deck=document.querySelector('#cr-reveal .cr-deck');
      return {
        cards:cards.map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),
        action:{top:action.top,bottom:action.bottom},
        viewport:{width:innerWidth,height:innerHeight},
        deckScrollable:deck.scrollHeight>deck.clientHeight+2
      };
    });
    expect(layout.cards).toHaveLength(5);
    const first=layout.cards[0];
    for(const card of layout.cards){
      expect(Math.abs(card.top-first.top)).toBeLessThan(3);
      expect(card.left).toBeGreaterThanOrEqual(-1);
      expect(card.right).toBeLessThanOrEqual(layout.viewport.width+1);
      expect(card.bottom).toBeLessThan(layout.action.top+1);
    }
    expect(layout.action.bottom).toBeLessThanOrEqual(layout.viewport.height+1);
    expect(layout.deckScrollable).toBe(false);
    await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
    await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
    expect(errors).toEqual([]);
  });
}


for(const viewport of [{width:1680,height:900},{width:1280,height:720},{width:1024,height:600}]){
  test('desktop final results and Sell All/Bank All fit at '+viewport.width+'x'+viewport.height,async({page})=>{
    const errors=await setup(page,{viewport});
    await purchase(page,5);
    await revealAll(page,5);
    await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
    const layout=await page.evaluate(()=>{
      const cards=[...document.querySelectorAll('#cr-reveal .cr-result-card')].map(el=>el.getBoundingClientRect());
      const sell=document.querySelector('#cr-reveal [data-cr="sell"]').getBoundingClientRect();
      const vault=document.querySelector('#cr-reveal [data-cr="vault"]').getBoundingClientRect();
      const scroll=document.querySelector('#cr-reveal .cr-results-scroll');
      const summary=document.querySelector('#cr-reveal .cr-summary').getBoundingClientRect();
      return {
        cards:cards.map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),
        sell:{top:sell.top,bottom:sell.bottom},
        vault:{top:vault.top,bottom:vault.bottom},
        summary:{top:summary.top,bottom:summary.bottom},
        viewport:{width:innerWidth,height:innerHeight},
        scrollNeeded:scroll.scrollHeight>scroll.clientHeight+2
      };
    });
    console.log('DESKTOP_RESULTS_GEOMETRY '+JSON.stringify(layout));
    expect(layout.cards).toHaveLength(5);
    for(const card of layout.cards){
      expect(Math.abs(card.top-layout.cards[0].top)).toBeLessThan(3);
      expect(card.left).toBeGreaterThanOrEqual(-1);
      expect(card.right).toBeLessThanOrEqual(layout.viewport.width+1);
      expect(card.bottom).toBeLessThanOrEqual(layout.sell.top+1);
    }
    expect(layout.summary.bottom).toBeLessThan(layout.cards[0].top+1);
    expect(layout.sell.bottom).toBeLessThanOrEqual(layout.viewport.height+1);
    expect(layout.vault.bottom).toBeLessThanOrEqual(layout.viewport.height+1);
    expect(layout.scrollNeeded).toBe(false);
    await page.locator('#cr-reveal [data-cr="vault"]').click();
    await expect(page.locator('#cr-reveal')).toBeHidden();
    expect(errors).toEqual([]);
  });
}


for(const viewport of [{width:1280,height:720},{width:375,height:812}]){
  test('no background reset or opacity flash when cards become results ('+viewport.width+'px)',async({page})=>{
    const errors=await setup(page,{viewport});
    await purchase(page,5);
    await page.evaluate(()=>{
      const root=document.querySelector('#cr-reveal');
      window.__revealBeforeResults={
        sky:root.querySelector('.cr-sky'),
        glow:root.querySelector('.cr-light'),
        shell:root.querySelector('.cr-shell'),
        toolbar:root.querySelector('.cr-toolbar'),
        layerCount:root.querySelectorAll('.cr-sky,.cr-light').length
      };
    });
    await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
    await expect(page.locator('#cr-reveal .cr-turn[disabled]')).toHaveCount(5);
    // Capture the shell immediately after the final card flip, before
    // the scheduled transition. Earlier card updates may legitimately rerender.
    await page.evaluate(()=>{
      const root=document.querySelector('#cr-reveal');
      window.__sceneImmediatelyBeforeResults={
        shell:root.querySelector('.cr-shell'),
        toolbar:root.querySelector('.cr-toolbar')
      };
    });
    await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
    const state=await page.evaluate(()=>{
      const root=document.querySelector('#cr-reveal');
      const before=window.__revealBeforeResults;
      const stage=root.querySelector('.cr-results');
      return {
        sameSky:root.querySelector('.cr-sky')===before.sky,
        sameGlow:root.querySelector('.cr-light')===before.glow,
        sameShell:root.querySelector('.cr-shell')===window.__sceneImmediatelyBeforeResults.shell,
        sameToolbar:root.querySelector('.cr-toolbar')===window.__sceneImmediatelyBeforeResults.toolbar,
        layerCount:root.querySelectorAll('.cr-sky,.cr-light').length,
        stageAnimation:stage.classList.contains('cr-phase-enter'),
        opacity:getComputedStyle(stage).opacity,
        cards:root.querySelectorAll('.cr-result-card').length,
        sellVisible:!!root.querySelector('[data-cr="sell"]'),
        vaultVisible:!!root.querySelector('[data-cr="vault"]')
      };
    });
    expect(state).toMatchObject({
      sameSky:true,sameGlow:true,sameShell:true,sameToolbar:true,
      layerCount:2,stageAnimation:false,opacity:'1',
      cards:5,sellVisible:true,vaultVisible:true
    });
    expect(errors).toEqual([]);
  });
}

test('individual last-card reveal transitions without reconstructing ambient scene',async({page})=>{
  const errors=await setup(page,{viewport:{width:1280,height:720}});
  await purchase(page,5);
  await page.evaluate(()=>{
    const root=document.querySelector('#cr-reveal');
    window.__ambientBeforeLast={sky:root.querySelector('.cr-sky'),shell:root.querySelector('.cr-shell')};
  });
  for(let i=0;i<5;i++){
    const card=page.locator('#cr-reveal .cr-turn:not([disabled])').first();
    await card.click();
    if(i<4)await expect(page.locator('#cr-reveal .cr-turn:not([disabled])')).toHaveCount(4-i);
  }
  await expect(page.locator('#cr-reveal .cr-turn[disabled]')).toHaveCount(5);
  await page.evaluate(()=>{
    window.__shellBeforeLastResult=document.querySelector('#cr-reveal .cr-shell');
  });
  await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
  expect(await page.evaluate(()=>{
    const root=document.querySelector('#cr-reveal');
    return root.querySelector('.cr-sky')===window.__ambientBeforeLast.sky &&
      root.querySelector('.cr-shell')===window.__shellBeforeLastResult &&
      !root.querySelector('.cr-results').classList.contains('cr-phase-enter');
  })).toBe(true);
  expect(errors).toEqual([]);
});

test('Bank rename keeps existing settled inventory and shows equipment actions',async({page})=>{
 const errors=await setup(page);
 await purchase(page,1);
 await expect(page.locator('#cr-reveal [data-cr="vault"]')).toContainText('BANK');
 await page.locator('#cr-reveal [data-cr="vault"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 await page.locator('nav.tabs [data-view="inventory"]').click();
 await expect(page.locator('#inventory')).toContainText('Your Bank');
 await expect(page.locator('#inventory .gear-main-nav')).toBeVisible();
 await expect(page.locator('#owned [data-act="gear-equip"]')).toHaveCount(1);
 const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(backend.inventory[0].status).toBe('vaulted');
 expect(errors).toEqual([]);
});

test('Equip, unequip and reload preserve gear and block accidental sale',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,2);
 await expect(page.locator('#owned [data-act="gear-equip"]')).toHaveCount(2);
 await page.locator('#owned [data-act="gear-equip"]').first().click();
 await expect(page.locator('#owned .inventory-protected-tag')).toContainText('Equipped');
 await expect(page.locator('#owned [data-act="gear-unequip"]')).toHaveCount(1);
 await expect(page.locator('#owned [data-act="sell"]')).toHaveCount(1);
 const blocked=await page.evaluate(async()=>{
   const backend=JSON.parse(sessionStorage.getItem('reveal-mock'));
   const instance=Object.values(backend.equipmentSlots)[0];
   const api=window.supabase.createClient();
   return Promise.all([
     api.rpc('rips_command',{action:'sell',payload:{id:instance}}),
     api.rpc('rips_command',{action:'sell_bulk',payload:{ids:[instance]}})
   ]);
 });
 expect(blocked.every(x=>/unequip|equipped/i.test(x.error?.message||''))).toBe(true);
 await page.reload();
 await page.locator('#games [data-act="game"][data-id="runescape"]').click();
 await page.locator('nav.tabs [data-view="inventory"]').click();
 await expect(page.locator('#owned [data-act="gear-unequip"]')).toHaveCount(1);
 await page.locator('#inventory .gear-main-nav [data-id="equipment"]').click();
 await expect(page.locator('#equipment-root .gear-slot.has-item')).toHaveCount(1);
 await page.locator('#equipment-root [data-act="gear-focus"][data-id="weapon"]').click();
 await page.locator('#equipment-root [data-act="gear-unequip"][data-id="weapon"]').click();
 await expect(page.locator('#equipment-root .gear-slot.has-item')).toHaveCount(0);
 await page.locator('#inventory .gear-main-nav [data-id="bank"]').click();
 await expect(page.locator('#owned [data-act="sell"]')).toHaveCount(2);
 expect(errors).toEqual([]);
});

test('Equipment set goals distinguish discovered, banked and equipped pieces',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,1);
 await page.locator('#inventory .gear-main-nav [data-id="equipment"]').click();
 await page.locator('#equipment-root [data-act="gear-tab"][data-id="sets"]').click();
 await expect(page.locator('#equipment-root .gear-set-card')).toHaveCount(1);
 await expect(page.locator('#equipment-root .gear-set-card')).toContainText('Test Starter Kit');
 await expect(page.locator('#equipment-root .gear-progress-label')).toContainText('1 / 2 owned');
 await expect(page.locator('#equipment-root .gear-piece.is-missing')).toHaveCount(1);
 await expect(page.locator('#equipment-root .gear-source-details')).toHaveCount(1);
 await page.locator('#equipment-root .gear-source-details summary').click();
 await expect(page.locator('#equipment-root .gear-source-details')).toContainText('2%');
 await page.locator('#equipment-root [data-act="gear-goal"]').click();
 await expect(page.locator('#equipment-root')).toContainText('Active goal');
 await page.locator('#inventory .gear-main-nav [data-id="bank"]').click();
 await expect(page.locator('#bank-goal')).toContainText('1 / 2 owned');
 expect(errors).toEqual([]);
});

test('Equip earned titles and showcase only voluntary public gear and badges',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,1);
 await page.locator('#owned [data-act="gear-equip"]').click();
 await page.locator('#inventory .gear-main-nav [data-id="equipment"]').click();
 await page.locator('#equipment-root [data-act="gear-tab"][data-id="achievements"]').click();
 await expect(page.locator('#equipment-root')).toContainText('First Steps');
 await page.locator('#equipment-root [data-act="gear-title"][data-id="first_equip"]').click();
 await expect(page.locator('#equipment-root')).toContainText('Title equipped');
 await page.locator('nav.tabs [data-view="showcase"]').click();
 await expect(page.locator('#showcase-equipment')).toContainText('First Steps');
 await expect(page.locator('#showcase-equipment')).toContainText('Rune scimitar');
 const mock=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(mock.titleCode).toBe('first_equip');
 expect(errors).toEqual([]);
});

test('Equipment and sets fit on a 375px mobile screen without horizontal overflow',async({page})=>{
 const errors=await setup(page,{viewport:{width:375,height:812}});
 await prepareInventory(page,2);
 await page.locator('#inventory .gear-main-nav [data-id="equipment"]').click();
 await expect(page.locator('#equipment-root .gear-slots .gear-slot')).toHaveCount(11);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
 await page.locator('#equipment-root [data-act="gear-tab"][data-id="sets"]').click();
 await expect(page.locator('#equipment-root .gear-piece')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
 expect(errors).toEqual([]);
});

test('Showroom equipment and badges are private by default until explicitly shared',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,1);
 await page.locator('#owned [data-act="gear-equip"]').click();
 await page.locator('nav.tabs [data-view="showcase"]').click();
 await expect(page.locator('#showcase-gear-controls')).toContainText('Share equipped gear: Off');
 await expect(page.locator('#showcase-gear-controls')).toContainText('Share badges and title: Off');
 const result=await page.evaluate(async()=>{
   const api=window.supabase.createClient();
   const get=()=>api.rpc('rips_equipment_command',{action:'showcase',payload:{owner:'another-user'}});
   const before=(await get()).data;
   await api.rpc('rips_equipment_command',{action:'visibility',payload:{gear:true}});
   const withGear=(await get()).data;
   await api.rpc('rips_equipment_command',{action:'visibility',payload:{badges:true}});
   const withBadges=(await get()).data;
   return {before,withGear,withBadges};
 });
 expect(result.before.slots).toHaveLength(0);
 expect(result.before.badges).toHaveLength(0);
 expect(result.withGear.slots).toHaveLength(1);
 expect(result.withGear.badges).toHaveLength(0);
 expect(result.withBadges.badges.length).toBeGreaterThan(0);
 await page.locator('#showcase-gear-controls [data-id="gear"]').click();
 await expect(page.locator('#showcase-gear-controls')).toContainText('Share equipped gear: Off');
 expect(errors).toEqual([]);
});

for(const viewport of [{width:375,height:812},{width:1280,height:850}]){
  test('five-pack swaps opening to cards to results without remounting sky or fullscreen shell ('+viewport.width+'px)',async({page})=>{
    const errors=await setup(page,{viewport});
    await page.locator('.boss-qty [data-id="5"]').click();
    await page.locator('#boss-details [data-act="purchase"]').click();
    await expect(page.locator('#cr-reveal .cr-opening')).toBeVisible();
    await page.evaluate(()=>{
      const r=document.getElementById('cr-reveal');
      window.__noFlashScene={
        sky:r.querySelector('.cr-sky'),
        glow:r.querySelector('.cr-light'),
        shell:r.querySelector('.cr-shell'),
        toolbar:r.querySelector('.cr-toolbar')
      };
    });
    await ripPack(page);
    await expect(page.locator('#cr-reveal .cr-turn')).toHaveCount(5);
    const afterOpening=await page.evaluate(()=>{
      const r=document.getElementById('cr-reveal'),previous=window.__noFlashScene;
      return {
        sameSky:r.querySelector('.cr-sky')===previous.sky,
        sameGlow:r.querySelector('.cr-light')===previous.glow,
        sameShell:r.querySelector('.cr-shell')===previous.shell,
        sameToolbar:r.querySelector('.cr-toolbar')===previous.toolbar,
        hasFiveCards:r.querySelectorAll('.cr-turn').length===5,
        phaseFaded:Boolean(r.querySelector('.cr-phase-enter'))
      };
    });
    expect(afterOpening).toEqual({
      sameSky:true,sameGlow:true,sameShell:true,sameToolbar:true,
      hasFiveCards:true,phaseFaded:false
    });
    await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
    await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
    const afterResults=await page.evaluate(()=>{
      const r=document.getElementById('cr-reveal'),previous=window.__noFlashScene;
      const result=r.querySelector('.cr-results');
      return {
        sameSky:r.querySelector('.cr-sky')===previous.sky,
        sameGlow:r.querySelector('.cr-light')===previous.glow,
        sameShell:r.querySelector('.cr-shell')===previous.shell,
        sameToolbar:r.querySelector('.cr-toolbar')===previous.toolbar,
        resultOpacity:parseFloat(getComputedStyle(result).opacity),
        resultAnimation:getComputedStyle(result).animationName,
        cardAnimations:[...r.querySelectorAll('.cr-result-card')].map(el=>getComputedStyle(el).animationName)
      };
    });
    expect(afterResults.sameSky).toBe(true);
    expect(afterResults.sameGlow).toBe(true);
    expect(afterResults.sameShell).toBe(true);
    expect(afterResults.sameToolbar).toBe(true);
    expect(afterResults.resultOpacity).toBe(1);
    expect(afterResults.resultAnimation).toBe('none');
    expect(afterResults.cardAnimations.every(a=>a==='none')).toBe(true);
    await page.locator('#cr-reveal [data-cr="vault"]').click();
    await expect(page.locator('#cr-reveal')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
test('partial multi-pack Bank/Sell and info toggles retain the result cards and background',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await purchase(page,5);
  await revealAll(page,5);
  await page.evaluate(()=>{
    const r=document.getElementById('cr-reveal');
    window.__steadyResults={
      shell:r.querySelector('.cr-shell'),
      sky:r.querySelector('.cr-sky'),
      stage:r.querySelector('.cr-results'),
      cards:[...r.querySelectorAll('.cr-result-card')]
    };
  });
  await page.locator('#cr-reveal [data-cr="info"]').click();
  await expect(page.locator('#cr-reveal .cr-detail')).toHaveCount(1);
  await page.locator('#cr-reveal [data-cr="info"]').click();
  await expect(page.locator('#cr-reveal .cr-detail')).toHaveCount(0);
  await page.locator('#cr-reveal .cr-result-card').first().click();
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(4);
  const stable=await page.evaluate(()=>{
    const r=document.getElementById('cr-reveal'),previous=window.__steadyResults;
    return {
      sky:r.querySelector('.cr-sky')===previous.sky,
      shell:r.querySelector('.cr-shell')===previous.shell,
      results:r.querySelector('.cr-results')===previous.stage,
      sameRemaining:[...r.querySelectorAll('.cr-result-card')].every((c,i)=>c===previous.cards[i+1]),
      toast:!!r.querySelector('.cr-toast'),
      isOpaque:getComputedStyle(r.querySelector('.cr-results')).opacity==='1'
    };
  });
  expect(stable).toEqual({
    sky:true,shell:true,results:true,sameRemaining:true,toast:true,isOpaque:true
  });
  await page.locator('#cr-reveal [data-cr="sell"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('five-pack opening keeps visible foil artwork from the first animation frame',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await page.locator('.boss-qty [data-id="5"]').click();
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('#cr-reveal .cr-pack-piece')).toHaveCount(5);
  await expect(page.locator('#cr-reveal')).toHaveClass(/cr-multi-batch/);
  const initial=await page.locator('#cr-reveal .cr-pack-piece').evaluateAll(nodes=>
    nodes.map(n=>({
      opacity:parseFloat(getComputedStyle(n).opacity),
      animation:getComputedStyle(n).animationName,
      isVisible:n.getBoundingClientRect().width>0
    }))
  );
  expect(initial.every(n=>n.opacity===1&&n.animation==='cr-multi-stack-in'&&n.isVisible)).toBe(true);
  await ripPack(page);
  await expect(page.locator('#cr-reveal .cr-turn')).toHaveCount(5);
  await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
  await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  expect(errors).toEqual([]);
});

for(const viewport of [{width:375,height:812},{width:1280,height:850}]){
  test('active five-pack opening never displays the Resume Opening shop underneath ('+viewport.width+'px)',async({page})=>{
    const errors=await setup(page,{viewport});
    await page.locator('.boss-qty [data-id="5"]').click();
    await page.locator('#boss-details [data-act="purchase"]').click();
    await expect(page.locator('#cr-reveal .cr-opening')).toBeVisible();
    await expect(page.locator('#storefront')).toHaveCSS('visibility','hidden');
    await expect(page.locator('#cr-reveal')).toHaveCSS('opacity','1');
    expect(await page.locator('#storefront').evaluate(el=>el.inert)).toBe(true);
    // Inspect successive painted animation frames, not only the final state.
    const sample=()=>page.evaluate(()=>new Promise(resolve=>{
      const frames=[];
      const read=()=>{
        const overlay=document.getElementById('cr-reveal');
        const shop=document.getElementById('storefront');
        frames.push({
          active:document.body.classList.contains('cr-reveal-active'),
          shopVisibility:getComputedStyle(shop).visibility,
          shopInert:shop.inert,
          overlayVisibility:getComputedStyle(overlay).visibility,
          overlayOpacity:parseFloat(getComputedStyle(overlay).opacity),
          overlayPosition:getComputedStyle(overlay).position,
          overlayHidden:overlay.hidden
        });
        if(frames.length<16)requestAnimationFrame(read);
        else resolve(frames);
      };
      requestAnimationFrame(read);
    }));
    const assertIsolated=frames=>expect(frames.every(f=>
      f.active&&f.shopVisibility==='hidden'&&f.shopInert&&
      f.overlayVisibility==='visible'&&f.overlayOpacity===1&&
      f.overlayPosition==='fixed'&&!f.overlayHidden
    )).toBe(true);
    assertIsolated(await sample());
    await ripPack(page);
    await expect(page.locator('#cr-reveal .cr-turn')).toHaveCount(5);
    assertIsolated(await sample());
    await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
    await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
    assertIsolated(await sample());
    await page.locator('#cr-reveal [data-cr="vault"]').click();
    await expect(page.locator('#cr-reveal')).toBeHidden();
    await expect(page.locator('#storefront')).toHaveCSS('visibility','visible');
    expect(await page.locator('#storefront').evaluate(el=>el.inert)).toBe(false);
    const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
    expect(backend.purchases).toBe(1);
    expect(backend.batch.rewards.every(r=>r.status==='vaulted')).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('purchase does not redraw Resume Opening behind the active reward screen',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await page.locator('.boss-qty [data-id="5"]').click();
  await page.evaluate(()=>{
    window.__shopBeforeReveal={
      element:document.getElementById('boss-details'),
      html:document.getElementById('boss-details').innerHTML
    };
  });
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('#cr-reveal .cr-opening')).toBeVisible();
  const during=await page.evaluate(()=>{
    const shop=document.getElementById('boss-details'),before=window.__shopBeforeReveal;
    // Exercise the ordinary storefront render callback while the overlay owns
    // the screen: it must only synchronize GP, not rebuild the pack picker.
    if(typeof window.render==='function')window.render();
    return {
      sameNode:shop===before.element,
      unchangedMarkup:shop.innerHTML===before.html,
      underlyingResume:!!shop.querySelector('[data-act="resume"]'),
      shopHidden:getComputedStyle(document.getElementById('storefront')).visibility==='hidden',
      overlayActive:document.body.classList.contains('cr-reveal-active')
    };
  });
  expect(during).toEqual({
    sameNode:true,unchangedMarkup:true,underlyingResume:false,
    shopHidden:true,overlayActive:true
  });
  // Back must restore the actual pending-purchase UI and make it clickable.
  await page.locator('#cr-reveal [data-cr="back"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  await expect(page.locator('#boss-details [data-act="resume"]')).toBeVisible();
  await expect(page.locator('#storefront')).toHaveCSS('visibility','visible');
  await page.locator('#boss-details [data-act="resume"]').click();
  await expect(page.locator('#cr-reveal .cr-opening')).toBeVisible();
  await ripPack(page);
  await expect(page.locator('#cr-reveal .cr-turn')).toHaveCount(5);
  await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
  await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(5);
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(backend.purchases).toBe(1);
  expect(errors).toEqual([]);
});
