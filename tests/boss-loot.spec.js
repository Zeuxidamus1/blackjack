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
async function setup(page,gp=1000000000){
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
 await page.route('https://prices.runescape.wiki/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"data":{}}'}));
 await page.route('https://static.runelite.net/**',r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64')}));
 await page.addInitScript(({catalog,cases,gp})=>{
   window.supabase={createClient:()=>({
     auth:{getSession:async()=>({data:{session:{access_token:'mock'}}}),signOut:async()=>({})},
     functions:{invoke:async()=>({data:{status:'fresh'}})},
     rpc:async(_name,{action,payload}={})=>{
       const state={id:'test',name:'Playwright',gp,items:[],market:[],pulls:{},
         nextDailyAt:new Date(Date.now()+86400000).toISOString(),serverTime:new Date().toISOString()};
       const values={
         catalog,cases,state,case_batch:null,
         case_purchase:{id:'11111111-1111-4111-8111-111111111111',case:payload?.case??'boss-starter',
           paid:1000,rewards:[{slot:1,item:null}]}
       };
       return {data:values[action]??{},error:null};
     }
   })};
 },{catalog:mockCatalog,cases:mockCases,gp});
 await page.goto('/');
 await expect(page.getByRole('button',{name:'Browse cases'}).first()).toBeVisible();
 await page.locator('article.tile').filter({hasText:'Boss Loot'}).getByRole('button',{name:'Browse cases'}).click();
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
 await expect(page.locator('dialog')).toContainText('Grails / Jackpot Items');
 await expect(page.locator('dialog')).toContainText('0.0001%');
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
 await expect(page.locator('dialog')).toContainText('5,000,000 GP');
 expect(errors).toEqual([]);
});