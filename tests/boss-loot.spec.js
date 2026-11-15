import {test,expect} from '@playwright/test';

const mockCases=[
 ['starter','Starter Loot',1000,'bronze'],
 ['select','Adventurer Loot',5000,'iron'],
 ['warrior','Warrior Loot',10000,'steel'],
 ['champion','Champion Loot',25000,'mithril'],
 ['elite','Elite Loot',50000,'adamant'],
 ['legendary','Legendary Loot',100000,'rune'],
 ['dragon','Dragon Loot',250000,'dragon'],
 ['slayer','Boss Slayer Loot',500000,'ancient'],
 ['premium','Mythic Loot',1000000,'infernal'],
 ['god','God Tier Loot',5000000,'divine']
].map(([id,name,price,theme])=>({
 id:'boss-'+id,name,price,pack:'boss',theme,accent:'#ce834d',symbol:'⚔',
 configVersion:2,description:'A collectible mystery pack.',
 rewards:[500000,200000,100000,80000,50000,30000,20000,10000,9999,1]
   .map((weight,index)=>({id:'boss_'+index,weight,chase:index===9}))
}));
const weights=[500000,200000,100000,80000,50000,30000,20000,10000,9999,1];
const mockCatalog=weights.map((weight,index)=>({
 id:'boss_'+index,pack:'boss',weight,name:'OSRS Item '+index,
 ge:1155+index,guide:(index+1)*1000,guideTime:new Date().toISOString(),
 found:3,circulation:5,salvage:0
}));
async function setup(page,gp=1000000000,{large=false,pulls={},orphan=false,oddsMismatch=false}={}){
 let catalogForTest=large?Array.from({length:49},(_,i)=>({
  id:'pool_item_'+i,pack:'boss',name:i===48?'Twisted bow':'OSRS Item '+i,
  ge:i===48?20997:1100+i,
  guide:i===48?1375875485:(i<23?200+i*25:1200+(i-23)*200),
  guideTime:new Date().toISOString(),found:0,circulation:0
 })):mockCatalog;
 if(orphan)catalogForTest.push({
   id:'orphan_item',pack:'boss',weight:1,name:'Unassigned collectible',
   ge:20000,guide:700000,guideTime:new Date().toISOString(),found:0,circulation:0,salvage:0
 });
 const ordinaryLow=Math.floor(840000000000/23);
 const winTotal=160000000000-10000;
 const ordinaryWin=Math.floor(winTotal/25);
 const oddsForTest=Array.from({length:49},(_,i)=>
  i===48?10000:i<23?(i===22?840000000000-ordinaryLow*22:ordinaryLow):
  (i===47?winTotal-ordinaryWin*24:ordinaryWin));
 const baseCases=large?[{...mockCases[0],rewards:catalogForTest.map((item,i)=>({
  id:item.id,weight:oddsForTest[i],chase:i===48
 }))},...mockCases.slice(1)]:mockCases;
 const casesForTest=oddsMismatch?baseCases.map(entry=>({...entry,
   rewards:entry.rewards.map((reward,i)=>i===0?{...reward,weight:1}:
     i===1?{...reward,weight:Number(reward.weight)+499999}:reward)
 })):baseCases;

 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
 await page.route('https://prices.runescape.wiki/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"data":{}}'}));
 await page.route('https://static.runelite.net/**',r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64')}));
 await page.addInitScript(({catalog,cases,gp,pulls})=>{
   window.supabase={createClient:()=>({
     auth:{getSession:async()=>({data:{session:{access_token:'mock'}}}),signOut:async()=>({})},
     functions:{invoke:async()=>({data:{status:'fresh'}})},
     rpc:async(_name,{action,payload}={})=>{
       const state={id:'test',name:'Playwright',gp,items:[],market:[],pulls,
         nextDailyAt:new Date(Date.now()+86400000).toISOString(),serverTime:new Date().toISOString()};
       const values={
         catalog,cases:window.__mockCasesOverride||cases,state,case_batch:null,reward_batch:null,
         case_purchase:{id:'11111111-1111-4111-8111-111111111111',case:payload?.case??'boss-starter',
           paid:1000,rewards:[{slot:1,item:null}]}
       };
       return {data:Object.prototype.hasOwnProperty.call(values,action)?values[action]:{},error:null};
     }
   })};
 },{catalog:catalogForTest,cases:casesForTest,gp,pulls});
 await page.goto('/');
 await expect(page.locator('#games [data-act="game"][data-id="runescape"]')).toBeVisible();
 await page.locator('#games [data-act="game"][data-id="runescape"]').click();
 await expect(page.locator('.premium-category')).toHaveCount(3);
 await page.locator('[data-act="category"][data-id="boss"]').click();
 await expect(page.locator('.boss-carousel')).toBeVisible();
 await expect(page.locator('.boss-slide')).toHaveCount(10);
 return errors;
}
test('desktop shows 10 priced custom packs and allows clicking adjacent pack',async({page})=>{
 const errors=await setup(page);
 await expect(page.getByText('Starter Loot').last()).toBeVisible();
 await expect(page.locator('#boss-details')).toContainText('1,000 GP');
 await page.getByRole('button',{name:'Select Adventurer Loot'}).click();
 await expect(page.locator('#boss-details h2')).toHaveText('Adventurer Loot');
 await expect(page.locator('#boss-details')).toContainText('5,000 GP');
 expect(await page.locator('.boss-carousel').evaluate(e=>getComputedStyle(e).scrollbarWidth)).toBe('none');
 expect(errors).toEqual([]);
});
test('What’s inside displays actual individual odds, item images, guide prices',async({page})=>{
 const errors=await setup(page);
 await page.getByRole('button',{name:/What.s inside/}).click();
 await expect(page.locator('dialog.boss-inside')).toBeVisible();
 await expect(page.locator('.inside-item')).toHaveCount(10);
 await expect(page.locator('.inside-item img')).toHaveCount(10);
 await expect(page.locator('#modal')).toContainText('Grails / Ultra-Rare Jackpots');
 await expect(page.locator('#modal')).toContainText('0.0001%');
 const total=weights.reduce((a,b)=>a+b,0); expect(total).toBe(1000000);
 expect(errors).toEqual([]);
});
test('click and drag pack carousel updates selected pack',async({page})=>{
 const errors=await setup(page);
 const carousel=page.locator('.boss-carousel'),rect=await carousel.boundingBox();
 expect(rect).toBeTruthy();
 const y=rect.y+rect.height/2;
 await page.mouse.move(rect.x+rect.width*.75,y);
 await page.mouse.down();
 await page.mouse.move(rect.x+rect.width*.25,y,{steps:12});
 await page.mouse.up();
 await expect.poll(()=>page.locator('#boss-details h2').textContent()).not.toBe('Starter Loot');
 expect(errors).toEqual([]);
});
test('mobile view has no page-wide overflow and two reward columns',async({page})=>{
 await page.setViewportSize({width:375,height:812});
 const errors=await setup(page);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 expect(overflow).toBe(false);
 await page.getByRole('button',{name:/What.s inside/}).click();
 expect(await page.locator('.inside-grid').first().evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(2);
 expect(errors).toEqual([]);
});
test('insufficient funds disable expensive opening while keeping preview available',async({page})=>{
 const errors=await setup(page,1000);
 await page.getByRole('button',{name:'Select God Tier Loot'}).click();
 await expect(page.locator('#boss-details button[data-act="purchase"]')).toBeDisabled();
 await page.getByRole('button',{name:/What.s inside/}).click();
 await expect(page.locator('#modal')).toContainText('5,000,000 GP');
 expect(errors).toEqual([]);
});

test('RuneScape opens Boss Loot and other categories stay accessible',async({page})=>{
 const errors=await setup(page);
 await expect(page.locator('#shop.boss-shop .boss-carousel')).toBeVisible();
 await expect(page.locator('#shop .tile')).toHaveCount(0);
 await expect(page.locator('#boss-details h2')).toHaveText('Starter Loot');
 await page.getByRole('button',{name:/Explore Packs/i}).click();
 await expect(page.locator('.premium-category')).toHaveCount(3);
 await page.getByRole('button',{name:'Open Boss Loot'}).click();
 await expect(page.locator('#shop.boss-shop .boss-carousel')).toBeVisible();
 expect(errors).toEqual([]);
});


test('49-item preview shows item-specific odds without profit summary boxes',async({page})=>{
 const errors=await setup(page,1000000000,{large:true});
 await page.locator('#boss-details [data-act="inside"]').click();
 await expect(page.locator('dialog.boss-inside')).toBeVisible();
 await expect(page.locator('.inside-item')).toHaveCount(49);
 await expect(page.locator('.inside-profit-stats')).toHaveCount(0);
 await expect(page.getByText('Combined chance of profit')).toHaveCount(0);
 await expect(page.locator('.inside-source-note')).toHaveCount(0);
 await expect(page.locator('.inside-item-details').last()).toContainText('0.000001%');
 await expect(page.locator('#modal')).toContainText('Profit Drops');
 await expect(page.locator('#modal')).toContainText('Big Wins');
 await expect(page.locator('#modal')).toContainText('Grails / Ultra-Rare Jackpots');
 const smallest=await page.locator('.inside-item-details').first().textContent();
 expect(smallest).toContain('200 GP');
 expect(errors).toEqual([]);
});


test('Collection Log renders real OSRS icons only for unlocked personally pulled items',async({page})=>{
 const errors=await setup(page,1000000000,{pulls:{boss_0:{count:2},boss_1:{count:1}}});
 await page.getByRole('button',{name:'Collection log'}).click();
 await expect(page.locator('#items .collection-unlocked')).toHaveCount(2);
 await expect(page.locator('#items .collection-locked')).toHaveCount(8);
 await expect(page.locator('#progress')).toContainText('2 / 10 personally pulled');
 const unlocked=page.locator('#items .collection-unlocked');
 await expect(unlocked.nth(0).locator('img.collection-item-icon')).toHaveAttribute(
   'src','https://static.runelite.net/cache/item/icon/1155.png');
 await expect(unlocked.nth(1).locator('img.collection-item-icon')).toHaveAttribute(
   'src','https://static.runelite.net/cache/item/icon/1156.png');
 await expect(unlocked.nth(0)).toContainText('×2');
 await expect(page.locator('#items .collection-locked img.collection-item-icon')).toHaveCount(8);
 await expect(page.locator('#items .collection-locked .collection-lock-overlay')).toHaveCount(8);
 await expect(page.locator('#items .collection-locked .symbol').first()).toContainText('🔒');
 await expect(page.locator('#items .collection-unlocked .collection-lock-overlay')).toHaveCount(0);
 await expect(page.locator('#items .item [data-act="collection-info"]')).toHaveCount(10);
 await expect(page.locator('#items')).not.toContainText('Updated');
 await page.reload();
 await page.locator('#games [data-act="game"]').click();
 await page.getByRole('button',{name:'Collection log'}).click();
 await expect(page.locator('#items .collection-unlocked img')).toHaveCount(2);
 expect(errors).toEqual([]);
});

test('Collection Log filters collected status, sorts GE value and rarity, and combines pack selection',async({page})=>{
 const errors=await setup(page,1000000000,{pulls:{boss_0:{count:2},boss_1:{count:1}}});
 await page.getByRole('button',{name:'Collection log'}).click();
 await expect(page.locator('#items .item')).toHaveCount(10);
 await expect(page.locator('#collection-count')).toHaveText('Showing 10 of 10 items');

 await page.locator('#collection-status').selectOption('collected');
 await expect(page.locator('#items .collection-unlocked')).toHaveCount(2);
 await expect(page.locator('#items .collection-locked')).toHaveCount(0);
 await expect(page.locator('#items .item h3')).toHaveText(['OSRS Item 0','OSRS Item 1']);

 await page.locator('#collection-sort').selectOption('value-high');
 await expect(page.locator('#items .item h3')).toHaveText(['OSRS Item 1','OSRS Item 0']);
 await page.locator('#collection-status').selectOption('uncollected');
 await expect(page.locator('#items .item')).toHaveCount(8);
 await expect(page.locator('#items .collection-unlocked')).toHaveCount(0);
 await expect(page.locator('#items .item h3').first()).toHaveText('OSRS Item 9');

 await page.locator('#collection-sort').selectOption('rare-high');
 await expect(page.locator('#items .item h3').first()).toHaveText('OSRS Item 9');
 await page.locator('#collection-sort').selectOption('rare-low');
 await expect(page.locator('#items .item h3').first()).toHaveText('OSRS Item 2');

 await page.locator('#collection-status').selectOption('all');
 await page.locator('#collection-sort').selectOption('value-low');
 await expect(page.locator('#items .item h3').first()).toHaveText('OSRS Item 0');
 await page.locator('#collection-sort').selectOption('name-desc');
 await expect(page.locator('#items .item h3').first()).toHaveText('OSRS Item 9');

 await page.locator('#filter').selectOption('clue');
 await expect(page.locator('#items .item')).toHaveCount(0);
 await expect(page.locator('#items')).toContainText('No items match these filters.');
 await page.locator('#filter').selectOption('boss');
 await expect(page.locator('#items .item')).toHaveCount(10);
 await expect(page.locator('#progress')).toContainText('2 / 10 personally pulled');
 expect(errors).toEqual([]);
});
test('Collection Log filters remain usable without horizontal overflow on narrow phones',async({page})=>{
 await page.setViewportSize({width:320,height:700});
 const errors=await setup(page,1000000000,{pulls:{boss_0:{count:1}}});
 await page.getByRole('button',{name:'Collection log'}).click();
 await expect(page.locator('#collection .collection-controls select')).toHaveCount(3);
 await page.locator('#collection-status').selectOption('collected');
 await page.locator('#collection-sort').selectOption('rare-high');
 await expect(page.locator('#items .item')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
 expect(errors).toEqual([]);
});

test('Collection Log falls back gracefully if an unlocked OSRS item icon fails to load',async({page})=>{
 const errors=await setup(page,1000000000,{pulls:{boss_0:{count:1}}});
 await page.route('https://static.runelite.net/cache/item/icon/1155.png',r=>r.abort());
 await page.getByRole('button',{name:'Collection log'}).click();
 const unlocked=page.locator('#items .collection-unlocked').first();
 await expect(unlocked.locator('.collection-item-icon')).toBeHidden();
 await expect(unlocked.locator('.collection-icon-fallback')).toBeVisible();
 await expect(unlocked).toContainText('OSRS Item 0');
 expect(errors).toEqual([]);
});


test('Locked items show visible OSRS artwork under a translucent lock and retain clean prices',async({page})=>{
 const errors=await setup(page);
 await page.getByRole('button',{name:'Collection log'}).click();
 const entry=page.locator('#items .collection-locked').first();
 await expect(entry.locator('img.collection-item-icon')).toHaveAttribute(
   'src','https://static.runelite.net/cache/item/icon/1155.png');
 await expect(entry.locator('.collection-lock-overlay')).toContainText('🔒');
 await expect(entry.locator('.collection-item-icon')).toBeVisible();
 await expect(entry).toContainText('GE guide · 1,000 GP');
 await expect(entry).not.toContainText('Updated');
 const opacity=await entry.locator('img').evaluate(e=>getComputedStyle(e).opacity);
 expect(Number(opacity)).toBeGreaterThan(0.3);
 expect(Number(opacity)).toBeLessThan(1);
 expect(errors).toEqual([]);
});

test('More Info lists every pack currently containing a locked item with actual case odds',async({page})=>{
 const errors=await setup(page);
 await page.getByRole('button',{name:'Collection log'}).click();
 await page.locator('#items .collection-locked').first()
   .getByRole('button',{name:'More Info'}).click();
 const dialog=page.locator('#modal');
 await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('OSRS Item 0');
 await expect(dialog).toContainText('Not collected');
 await expect(dialog.getByRole('heading',{name:'Found in 10 packs'})).toBeVisible();
 await expect(dialog.locator('.collection-source')).toHaveCount(10);
 await expect(dialog.locator('.collection-source').first()).toContainText('Starter Loot');
 await expect(dialog.locator('.collection-source').first()).toContainText('1,000 GP');
 await expect(dialog.locator('.collection-source').first()).toContainText('50%');
 await expect(dialog.locator('.collection-source').last()).toContainText('God Tier Loot');
 await expect(dialog.locator('.collection-source').last()).toContainText('5,000,000 GP');
 await dialog.getByRole('button',{name:'✕'}).click();
 await expect(dialog).not.toBeVisible();
 expect(errors).toEqual([]);
});

test('More Info is available for collected items and shows their owned status',async({page})=>{
 const errors=await setup(page,1000000000,{pulls:{boss_1:{count:3}}});
 await page.getByRole('button',{name:'Collection log'}).click();
 await page.locator('#items .collection-unlocked').first()
   .getByRole('button',{name:'More Info'}).click();
 const dialog=page.locator('#modal');
 await expect(dialog).toContainText('OSRS Item 1');
 await expect(dialog).toContainText('Collected');
 await expect(dialog.getByRole('heading',{name:'Found in 10 packs'})).toBeVisible();
 await expect(dialog).not.toContainText('Updated');
 expect(errors).toEqual([]);
});

test('More Info does not invent pack sources for items absent from all active reward pools',async({page})=>{
 const errors=await setup(page,1000000000,{orphan:true});
 await page.getByRole('button',{name:'Collection log'}).click();
 const entry=page.locator('#items .collection-locked')
   .filter({hasText:'Unassigned collectible'});
 await expect(entry).toBeVisible();
 await entry.getByRole('button',{name:'More Info'}).click();
 const dialog=page.locator('#modal');
 await expect(dialog.getByRole('heading',{name:'Found in 0 packs'})).toBeVisible();
 await expect(dialog).toContainText('not currently obtainable from an active pack');
 await expect(dialog.locator('.collection-source')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('Collection details refresh stale pack data before showing a zero-source result',async({page})=>{
 const errors=await setup(page,1000000000,{orphan:true});
 await page.getByRole('button',{name:'Collection log'}).click();
 const item=page.locator('#items .collection-locked').filter({hasText:'Unassigned collectible'});
 await expect(item).toBeVisible();
 await page.evaluate(async()=>{
   const {data}=await window.supabase.createClient().rpc('rips_command',{action:'cases'});
   window.__mockCasesOverride=data.map((entry,index)=>index===0?
     {...entry,rewards:[...entry.rewards,{id:'orphan_item',weight:1,chase:false}]}:entry);
 });
 await item.getByRole('button',{name:'More Info'}).click();
 const dialog=page.locator('#modal');
 await expect(dialog.getByRole('heading',{name:'Found in 1 pack'})).toBeVisible();
 await expect(dialog.locator('.collection-source')).toHaveCount(1);
 await expect(dialog).toContainText('Starter Loot');
 await expect(dialog).toContainText('Drop chance');
 await expect(dialog).not.toContainText('not currently obtainable');
 expect(errors).toEqual([]);
});

test('Collection Log uses actual pack odds rather than outdated catalog rarity percentages',async({page})=>{
 const errors=await setup(page,1000000000,{oddsMismatch:true});
 await page.getByRole('button',{name:'Collection log'}).click();
 const item=page.locator('#items .item').filter({hasText:'OSRS Item 0'});
 await expect(item.locator('.rare')).toContainText('Best pack chance 0.0001%');
 await expect(item.locator('.rare')).not.toContainText('50%');
 await page.locator('#collection-sort').selectOption('rare-high');
 await expect(page.locator('#items .item h3').first()).toHaveText('OSRS Item 0');
 await item.getByRole('button',{name:'More Info'}).click();
 await expect(page.locator('#modal .collection-source-odds').first()).toContainText('0.0001%');
 expect(errors).toEqual([]);
});

test('Collection item detail list scrolls on narrow phones without overflowing the screen',async({page})=>{
 await page.setViewportSize({width:320,height:700});
 const errors=await setup(page);
 await page.getByRole('button',{name:'Collection log'}).click();
 await page.locator('#items .collection-locked').first().getByRole('button',{name:'More Info'}).click();
 const dialog=page.locator('#modal');
 await expect(dialog.locator('.collection-source')).toHaveCount(10);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
 const sizing=await dialog.evaluate(e=>({
   width:e.getBoundingClientRect().width,
   height:e.getBoundingClientRect().height,
   viewport:window.innerHeight,
   scroll:e.scrollHeight
 }));
 expect(sizing.width).toBeLessThanOrEqual(320);
 expect(sizing.height).toBeLessThanOrEqual(sizing.viewport);
 expect(errors).toEqual([]);
});
