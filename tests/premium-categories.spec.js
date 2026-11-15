import {test,expect} from '@playwright/test';

const catalog=[
 {id:'boss_1',pack:'boss',name:'Rune scimitar',ge:1333,guide:1000},
 {id:'boss_2',pack:'boss',name:'Dragon longsword',ge:1305,guide:2000},
 {id:'clue_1',pack:'clue',name:'Gold headband',ge:12303,guide:650},
 {id:'clue_2',pack:'clue',name:'Gilded scimitar',ge:12389,guide:11000000},
 {id:'clue_3',pack:'clue',name:'Red headband',ge:2645,guide:1780},
 {id:'clue_4',pack:'clue',name:'Adamant helm (h2)',ge:10298,guide:2600},
 {id:'clue_5',pack:'clue',name:'Dragon cane',ge:12373,guide:20200},
 {id:'clue_6',pack:'clue',name:'3rd Age robe top',ge:10338,guide:120000000},
 {id:'pet_1',pack:'pets',name:'Rock golem',ge:null,guide:500},
 {id:'pet_2',pack:'pets',name:'Beaver',ge:null,guide:1900},
 {id:'pet_3',pack:'pets',name:'Phoenix',ge:null,guide:3200},
 {id:'pet_4',pack:'pets',name:'Heron',ge:null,guide:5500},
 {id:'pet_5',pack:'pets',name:'Hellpuppy',ge:null,guide:5000000},
 {id:'pet_6',pack:'pets',name:'Abyssal orphan',ge:null,guide:5100000}
].map(x=>({...x,guideTime:new Date().toISOString(),found:0,circulation:0,salvage:0}));

function makeCase(pack,id,name,price,ids){
 return {id,pack,name,price,theme:'classic',accent:'#a786df',symbol:'⚔',
  description:'',configVersion:1,rewards:ids.map((item,i)=>({
   id:item,weight:i===0?750000:250000,chase:i===1
  }))};
}
const cases=[
 makeCase('boss','boss-starter','Starter Loot',1000,['boss_1','boss_2']),
 makeCase('clue','clue-starter','Starter',1000,['clue_1','clue_2']),
 makeCase('clue','clue-select','Select',2500,['clue_3','clue_4']),
 makeCase('clue','clue-premium','Premium',25000,['clue_5','clue_6']),
 makeCase('pets','pets-starter','Starter',1000,['pet_1','pet_2']),
 makeCase('pets','pets-select','Select',4000,['pet_3','pet_4']),
 makeCase('pets','pets-premium','Premium',12000000,['pet_5','pet_6'])
];

async function setup(page,{gp=25000000,width=1280,height=850}={}){
 await page.setViewportSize({width,height});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({
  status:200,contentType:'application/javascript',body:''
 }));
 await page.route('https://static.runelite.net/**',r=>r.fulfill({
  status:200,contentType:'image/png',
  body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64')
 }));
 await page.addInitScript(({catalog,cases,gp})=>{
  let backend={gp,batch:null,vaulted:[],purchases:0};
  const snapshot=()=>backend.batch && ({
   id:backend.batch.id,case:backend.batch.case,quantity:backend.batch.quantity,
   paid:backend.batch.paid,
   remaining:backend.batch.rewards.filter(x=>x.status==='pending').length,
   rewards:backend.batch.rewards.map(r=>({
    ...r,item:r.revealed?r.item:null,instance:r.revealed?r.instance:null,
    value:r.revealed?catalog.find(x=>x.id===r.item)?.guide:null,
    priceUpdated:new Date().toISOString(),settledValue:null
   }))
  });
  window.__testAccount=backend;
  window.supabase={createClient:()=>({
   auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),signOut:async()=>({error:null})},
   functions:{invoke:async()=>({data:{status:'fresh'},error:null})},
   rpc:async(_method,{action,payload}={})=>{
    const ok=data=>({data,error:null});
    const fail=message=>({data:null,error:{message}});
    if(action==='state')return ok({
     id:'11111111-1111-4111-8111-111111111111',name:'Test',
     gp:backend.gp,items:[],market:[],pulls:{},
     nextDailyAt:new Date(Date.now()+86400000).toISOString(),
     serverTime:new Date().toISOString()
    });
    if(action==='catalog')return ok(catalog);
    if(action==='cases')return ok(cases);
    if(action==='reward_batch')return ok(backend.batch?.rewards.some(x=>x.status==='pending')?snapshot():null);
    if(action==='case_purchase'){
     const entry=cases.find(c=>c.id===payload?.case);
     const quantity=Number(payload?.quantity);
     if(!entry||!Number.isInteger(quantity)||quantity<1||quantity>5)return fail('Invalid pack');
     if(backend.batch?.rewards.some(x=>x.status==='pending'))return fail('Unresolved rewards');
     const paid=entry.price*quantity;
     if(backend.gp<paid)return fail('Insufficient GP');
     backend.gp-=paid;
     backend.purchases++;
     backend.batch={
      id:payload.request,case:entry.id,paid,quantity,
      rewards:Array.from({length:quantity},(_,i)=>({
       slot:i+1,item:entry.rewards[i%entry.rewards.length].id,
       instance:'test-instance-'+i,status:'pending',revealed:false
      }))
     };
     return ok(snapshot());
    }
    if(action==='reward_reveal'){
     if(!backend.batch||backend.batch.id!==payload?.batch)return fail('Invalid session');
     for(const reward of backend.batch.rewards){
      if(payload.slot==null||payload.slot===reward.slot)reward.revealed=true;
     }
     return ok(snapshot());
    }
    if(action==='reward_settle'){
     const chosen=backend.batch.rewards.filter(r=>payload?.slots?.includes(r.slot));
     if(!chosen.length||chosen.some(r=>r.status!=='pending'||!r.revealed))return fail('Invalid rewards');
     if(payload?.decision==='sell'){
      if(chosen.some(r=>!catalog.find(i=>i.id===r.item)?.ge))return fail('No GE quote');
      backend.gp+=chosen.reduce((a,r)=>a+catalog.find(i=>i.id===r.item).guide,0);
     }
     chosen.forEach(r=>{r.status=payload.decision==='sell'?'sold':'vaulted';});
     return ok(snapshot());
    }
    return ok(null);
   }
  })};
 },{catalog,cases,gp});
 await page.goto('/');
 await expect(page.locator('#games [data-act="game"][data-id="runescape"]')).toBeVisible();
 await page.locator('#games [data-act="game"][data-id="runescape"]').click();
 await expect(page.locator('.premium-category')).toHaveCount(3);
 return errors;
}
async function go(page,category){
 await page.locator('.premium-category[data-act="category"][data-id="'+category+'"]').click();
 await expect(page.locator('.boss-carousel')).toBeVisible();
}
test('All categories use premium collectible artwork in the category gallery',async({page})=>{
 const errors=await setup(page);
 await expect(page.locator('.premium-category .boss-foil')).toHaveCount(3);
 await expect(page.locator('.premium-category .boss-foil[data-foil-pack="boss"]')).toHaveCount(1);
 await expect(page.locator('.premium-category .boss-foil[data-foil-pack="clue"]')).toHaveCount(1);
 await expect(page.locator('.premium-category .boss-foil[data-foil-pack="pets"]')).toHaveCount(1);
 expect(errors).toEqual([]);
});
test('Clue Caskets use smooth premium carousel with three distinct pack artworks and original prices',async({page})=>{
 const errors=await setup(page);
 await go(page,'clue');
 await expect(page.locator('.boss-shell')).toHaveAttribute('data-pack','clue');
 await expect(page.locator('.boss-slide')).toHaveCount(3);
 await expect(page.locator('.boss-slide .boss-foil').first()).toHaveAttribute('data-foil-pack','clue');
 await expect(page.locator('.boss-slide .boss-foil')).toHaveCount(3);
 await expect(page.locator('#boss-details')).toContainText('1,000 GP');
 await page.getByRole('button',{name:'Select Select'}).click();
 await expect(page.locator('#boss-details h2')).toHaveText('Select');
 await expect(page.locator('#boss-details')).toContainText('2,500 GP');
 await page.getByRole('button',{name:'Select Premium'}).click();
 await expect(page.locator('#boss-details')).toContainText('25,000 GP');
 const themes=await page.locator('.boss-slide .boss-foil').evaluateAll(elements=>elements.map(e=>e.dataset.theme));
 expect(new Set(themes).size).toBe(3);
 expect(await page.locator('.boss-carousel').evaluate(e=>getComputedStyle(e).scrollbarWidth)).toBe('none');
 expect(errors).toEqual([]);
});
test('Clue What’s Inside uses premium item grid and exact server-reported odds',async({page})=>{
 const errors=await setup(page);
 await go(page,'clue');
 await page.getByRole('button',{name:/What.s inside/}).click();
 await expect(page.locator('dialog.boss-inside')).toBeVisible();
 await expect(page.locator('#modal')).toContainText('CLUE CASKET');
 await expect(page.locator('.inside-item')).toHaveCount(2);
 await expect(page.locator('.inside-item img')).toHaveCount(2);
 await expect(page.locator('#modal')).toContainText('Drop chance · 75%');
 await expect(page.locator('#modal')).toContainText('Drop chance · 25%');
 await expect(page.locator('.inside-profit-stats')).toHaveCount(0);
 await expect(page.locator('.odds')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('Pet Hunt preserves prices, shows genuine pet icons and groups rewards by rarity',async({page})=>{
 const errors=await setup(page);
 await go(page,'pets');
 await expect(page.locator('.boss-slide')).toHaveCount(3);
 await expect(page.locator('.boss-slide .boss-foil[data-foil-pack="pets"]')).toHaveCount(3);
 await page.getByRole('button',{name:'Select Select'}).click();
 await expect(page.locator('#boss-details')).toContainText('4,000 GP');
 await page.getByRole('button',{name:'Select Premium'}).click();
 await expect(page.locator('#boss-details')).toContainText('12,000,000 GP');
 await page.getByRole('button',{name:/What.s inside/}).click();
 await expect(page.locator('#modal')).toContainText('PET HUNT');
 await expect(page.locator('.inside-item')).toHaveCount(2);
 await expect(page.locator('.inside-item img')).toHaveCount(2);
 await expect(page.locator('.inside-custom-note')).toContainText('server-assigned GP values');
 await expect(page.locator('#modal')).toContainText('Pet Hunt value');
 await expect(page.locator('#modal')).toContainText('Common Pets and Rewards');
 await expect(page.locator('#modal')).toContainText('Legendary Jackpot');
 await expect(page.locator('#modal')).toContainText('Rarity · Common');
 expect(errors).toEqual([]);
});
test('Mouse dragging and tapping a neighboring Clue pack work',async({page})=>{
 const errors=await setup(page);
 await go(page,'clue');
 const carousel=page.locator('.boss-carousel'),rect=await carousel.boundingBox();
 const y=rect.y+rect.height/2;
 await page.mouse.move(rect.x+rect.width*.75,y);
 await page.mouse.down();
 await page.mouse.move(rect.x+rect.width*.25,y,{steps:12});
 await page.mouse.up();
 await expect.poll(()=>page.locator('#boss-details h2').textContent()).not.toBe('Starter');
 await page.getByRole('button',{name:'Select Premium'}).click();
 await expect(page.locator('#boss-details h2')).toHaveText('Premium');
 expect(errors).toEqual([]);
});
test('Category switching preserves premium design and live selected GP information',async({page})=>{
 const errors=await setup(page);
 await go(page,'clue');
 await page.locator('.premium-pack-nav [data-id="pets"]').click();
 await expect(page.locator('.boss-shell')).toHaveAttribute('data-pack','pets');
 await expect(page.locator('#boss-details')).toContainText('1,000 GP');
 await page.locator('.premium-pack-nav [data-id="boss"]').click();
 await expect(page.locator('.boss-shell')).toHaveAttribute('data-pack','boss');
 await expect(page.locator('#boss-details h2')).toHaveText('Starter Loot');
 expect(errors).toEqual([]);
});
test('Clue purchase enters the same full-screen pack reveal and supports Vault',async({page})=>{
 const errors=await setup(page);
 await go(page,'clue');
 await page.locator('#boss-details [data-act="purchase"]').click();
 await expect(page.locator('#cr-reveal')).toBeVisible();
 await expect(page.locator('#cr-reveal .boss-foil[data-foil-pack="clue"]')).toBeVisible();
 await page.locator('[data-cr="rip"]').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('.cr-single-name')).toHaveText('Gold headband');
 await expect(page.locator('[data-cr="sell"]')).toBeEnabled();
 await page.locator('[data-cr="vault"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 expect(errors).toEqual([]);
});
test('Pet purchase enters the same premium reveal and offers Vault without an invalid GE sale',async({page})=>{
 const errors=await setup(page);
 await go(page,'pets');
 await page.locator('#boss-details [data-act="purchase"]').click();
 await expect(page.locator('#cr-reveal .boss-foil[data-foil-pack="pets"]')).toBeVisible();
 await page.locator('[data-cr="rip"]').focus();
 await page.keyboard.press('Enter');
 await expect(page.locator('.cr-single-name')).toHaveText('Rock golem');
 await expect(page.locator('[data-cr="sell"]')).toBeDisabled();
 await expect(page.locator('#cr-reveal')).toContainText('GE selling is unavailable');
 await page.locator('[data-cr="vault"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 expect(errors).toEqual([]);
});
test('Mobile Clue and Pet views are scrollable and show two-column reward previews',async({page})=>{
 const errors=await setup(page,{width:375,height:812});
 for(const cat of ['clue','pets']){
  await go(page,cat);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  await page.getByRole('button',{name:/What.s inside/}).click();
  const cols=await page.locator('.inside-grid').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length);
  expect(cols).toBe(2);
  await page.locator('#modal [data-act="close"]').click();
  await page.locator('.boss-top [data-act="categories"]').click();
 }
 expect(errors).toEqual([]);
});
test('Unfunded Pet Premium pack remains viewable but cannot be purchased',async({page})=>{
 const errors=await setup(page,{gp:1000});
 await go(page,'pets');
 await page.getByRole('button',{name:'Select Premium'}).click();
 await expect(page.locator('#boss-details [data-act="purchase"]')).toBeDisabled();
 await page.getByRole('button',{name:/What.s inside/}).click();
 await expect(page.locator('#modal')).toContainText('12,000,000 GP');
 expect(errors).toEqual([]);
});

test('Pet Hunt maps the rarity price bands from Common to Legendary',async({page})=>{
 const errors=await setup(page);
 const indices=await page.evaluate(()=>[
   450,1550,12000,3500000,9000000,18000000,42000000,150000000
 ].map(guide=>window.petRarityIndex({guide})));
 expect(indices).toEqual([0,1,2,0,1,2,3,4]);
 expect(errors).toEqual([]);
});
