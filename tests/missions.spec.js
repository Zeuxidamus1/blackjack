import {test,expect} from '@playwright/test';

const missions=[
 {id:'daily_open_3',cadence:'daily',title:'Open 3 packs',description:'Open any three mystery packs.',metric:'packs',goal:3,reward:2000,sort:1},
 {id:'daily_discover_2',cadence:'daily',title:'Collect 2 different items',description:'Reveal two different item types from packs today.',metric:'discovery',goal:2,reward:4000,sort:2},
 {id:'daily_sell_3',cadence:'daily',title:'Sell 3 items',description:'Sell three items through the GE or player market.',metric:'sales',goal:3,reward:3000,sort:3},
 {id:'weekly_open_25',cadence:'weekly',title:'Open 25 packs',description:'Open 25 mystery packs this week.',metric:'packs',goal:25,reward:25000,sort:1},
 {id:'weekly_discover_8',cadence:'weekly',title:'Collect 8 different items',description:'Reveal eight different item types from packs this week.',metric:'discovery',goal:8,reward:30000,sort:2},
 {id:'weekly_sell_15',cadence:'weekly',title:'Sell 15 items',description:'Sell fifteen items through the GE or player market.',metric:'sales',goal:15,reward:18000,sort:3}
];
async function setup(page,opts={}){
 if(opts.mobile)await page.setViewportSize({width:375,height:812});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({
   status:200,contentType:'application/javascript',body:''
 }));
 await page.route('https://static.runelite.net/**',route=>route.fulfill({
   status:200,contentType:'image/png',
   body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64')
 }));
 await page.addInitScript(({missions,opts})=>{
   const initial=()=>({gp:100000,opened:opts.opened??2,discovered:opts.discovered??1,sold:opts.sold??0,claims:[]});
   let backend=JSON.parse(sessionStorage.getItem('missions-test')||'null')||initial();
   const save=()=>sessionStorage.setItem('missions-test',JSON.stringify(backend));
   const date=new Date(),dayStart=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate());
   const weekday=date.getUTCDay();
   const weekStart=dayStart-((weekday+6)%7)*86400000;
   const board=claimedAmount=>{
     const result=missions.map(m=>{
       const progress=backend[m.metric==='packs'?'opened':m.metric==='discovery'?'discovered':'sold'];
       const claimed=backend.claims.includes(m.id);
       return {...m,progress:Math.min(m.goal,progress),claimed,
         available:progress>=m.goal&&!claimed};
     });
     return {serverTime:new Date().toISOString(),
       dailyResetAt:new Date(dayStart+86400000).toISOString(),
       weeklyResetAt:new Date(weekStart+7*86400000).toISOString(),
       daily:result.filter(m=>m.cadence==='daily'),
       weekly:result.filter(m=>m.cadence==='weekly'),
       claimedAmount};
   };
   window.supabase={createClient:()=>({
     auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),signOut:async()=>({error:null})},
     functions:{invoke:async()=>({data:{status:'fresh'},error:null})},
     rpc:async(_fn,{action,payload}={})=>{
       const ok=data=>({data,error:null});
       const fail=message=>({data:null,error:{message}});
       if(action==='state')return ok({
         id:'11111111-1111-4111-8111-111111111111',name:'Missions Test',
         gp:backend.gp,items:[],market:[],pulls:{},
         nextDailyAt:new Date(Date.now()+3600000).toISOString(),
         serverTime:new Date().toISOString()
       });
       if(action==='catalog')return ok([{
         id:'reward_1',pack:'boss',name:'Rune scimitar',guide:12000,ge:1115,
         guideTime:new Date().toISOString(),weight:1,found:0,circulation:0
       }]);
       if(action==='cases')return ok([{
         id:'boss-starter',pack:'boss',name:'Starter Loot',price:1000,
         theme:'bronze',accent:'#be854c',symbol:'⚔',rewards:[{id:'reward_1',weight:1000000,chase:false}]
       }]);
       if(action==='reward_batch')return ok(null);
       if(action==='mission_status')return ok(board(0));
       if(action==='mission_claim'){
         const mission=missions.find(m=>m.id===payload?.id);
         if(!mission)return fail('Mission not found.');
         if(backend.claims.includes(mission.id))return fail('This mission reward was already claimed.');
         const progress=backend[mission.metric==='packs'?'opened':mission.metric==='discovery'?'discovered':'sold'];
         if(progress<mission.goal)return fail('This mission is not complete yet.');
         backend.gp+=mission.reward;
         backend.claims.push(mission.id);
         save();
         return ok(board(mission.reward));
       }
       return ok(null);
     }
   })};
 },{missions,opts});
 await page.goto('/');
 await expect(page.locator('#games [data-act="game"]')).toBeVisible();
 await page.locator('#games [data-act="game"][data-id="runescape"]').click();
 await page.locator('button[data-view="missions"]').click();
 await expect(page.locator('.mission-group')).toHaveCount(2);
 return errors;
}

test('daily and weekly missions render actual server progress, rewards and reset clocks',async({page})=>{
 const errors=await setup(page,{opened:2,discovered:1,sold:0});
 await expect(page.locator('.mission-card')).toHaveCount(6);
 await expect(page.locator('.mission-group').first()).toContainText('Open 3 packs');
 await expect(page.locator('.mission-group').first()).toContainText('2 / 3');
 await expect(page.locator('.mission-group').first()).toContainText('+2,000 GP');
 await expect(page.locator('.mission-group').last()).toContainText('Open 25 packs');
 await expect(page.locator('.mission-group').last()).toContainText('0 / 15');
 await expect(page.locator('.mission-timer strong').first()).not.toHaveText('--:--:--');
 await expect(page.locator('.mission-claim-button:not([disabled])')).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('completed daily mission credits GP once, shows claimed state and persists reload',async({page})=>{
 const errors=await setup(page,{opened:3,discovered:1,sold:0});
 const card=page.locator('.mission-card').filter({hasText:'Open 3 packs'});
 await expect(card).toContainText('Mission complete');
 await card.getByRole('button',{name:'Claim 2,000 GP'}).click();
 await expect(page.locator('#balance')).toHaveText('102,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveText('+2,000 GP');
 await expect(card.getByRole('button',{name:'✓ Claimed'})).toBeDisabled();
 const before=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('missions-test')));
 expect(before.claims).toEqual(['daily_open_3']);
 await page.reload();
 await page.locator('#games [data-act="game"][data-id="runescape"]').click();
 await page.locator('[data-view="missions"]').click();
 await expect(page.locator('.mission-card').filter({hasText:'Open 3 packs'}).getByRole('button',{name:'✓ Claimed'})).toBeDisabled();
 const again=await page.evaluate(async()=>await window.supabase.createClient().rpc('rips_command',{action:'mission_claim',payload:{id:'daily_open_3'}}));
 expect(again.error?.message).toContain('already claimed');
 const after=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('missions-test')));
 expect(after.gp).toBe(before.gp);
 expect(errors).toEqual([]);
});
test('weekly rewards can be claimed separately from daily rewards',async({page})=>{
 const errors=await setup(page,{opened:26,discovered:9,sold:16});
 await expect(page.locator('.mission-claim-button:not([disabled])')).toHaveCount(6);
 const openDaily=page.locator('.mission-card').filter({hasText:'Open 3 packs'});
 const openWeekly=page.locator('.mission-card').filter({hasText:'Open 25 packs'});
 await openDaily.getByRole('button',{name:'Claim 2,000 GP'}).click();
 await openWeekly.getByRole('button',{name:'Claim 25,000 GP'}).click();
 await expect(page.locator('#balance')).toHaveText('127,000 GP');
 await expect(page.locator('.mission-claim-button:not([disabled])')).toHaveCount(4);
 expect(errors).toEqual([]);
});
test('incomplete claims and fabricated browser progress cannot grant GP',async({page})=>{
 const errors=await setup(page,{opened:0,discovered:0,sold:0});
 const response=await page.evaluate(async()=>window.supabase.createClient().rpc('rips_command',{action:'mission_claim',payload:{id:'daily_open_3',progress:999999,reward:10000000}}));
 expect(response.error?.message).toContain('not complete');
 const state=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('missions-test')||'null'));
 expect(state).toBeNull();
 await expect(page.locator('#balance')).toHaveText('100,000 GP');
 expect(errors).toEqual([]);
});
test('phone layout stays responsive and missions refresh from server',async({page})=>{
 const errors=await setup(page,{opened:3,discovered:2,sold:3,mobile:true});
 await expect(page.locator('.mission-group')).toHaveCount(2);
 await page.locator('[data-act="mission-refresh"]').click();
 await expect(page.locator('.mission-claim-button:not([disabled])')).toHaveCount(3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
 expect(errors).toEqual([]);
});
