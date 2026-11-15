import {test,expect} from '@playwright/test';

const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64');
async function setup(page,{gp=0,daily=false,pending=false,readyCollection=true}={}){
  await page.setViewportSize({width:375,height:812});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.route('https://prices.runescape.wiki/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"data":{}}'}));
  await page.route('https://static.runelite.net/**',r=>r.fulfill({status:200,contentType:'image/png',body:tinyPng}));
  await page.addInitScript(({gp,daily,pending,readyCollection})=>{
    let wallet=gp,claimedDaily=!daily,claimedRecovery=false,claimedMilestone=false;
    const dailyNext=new Date(Date.now()+24*60*60*1000).toISOString();
    const stamp=new Date().toISOString();
    const catalog=[{id:'boss_0',pack:'boss',weight:100,ge:4151,name:'Abyssal whip',guide:1000000,guideTime:stamp,found:0,circulation:0,salvage:0}];
    const cases=[{id:'boss-starter',pack:'boss',name:'Starter Loot',price:1000,theme:'bronze',accent:'#ce834d',symbol:'⚔',description:'Starter prizes',rewards:[{id:'boss_0',weight:1000000000000}]}];
    window.__economyCalls=[];
    const board=()=>({
      gp:wallet,dailyAmount:50000,minimumPackPrice:1000,
      recovery:{amount:5000,available:wallet<1000&&!claimedRecovery&&!pending,
        balanceTooHigh:wallet>=1000,pendingPack:pending,nextAt:claimedRecovery?dailyNext:null},
      milestones:[{code:'boss:first',pack:'boss',stage:'first',title:'First find',goal:1,
        found:readyCollection?1:0,total:50,amount:2000,claimed:claimedMilestone,
        available:readyCollection&&!claimedMilestone}]
    });
    window.supabase={createClient:()=>({
      auth:{getSession:async()=>({data:{session:{access_token:'mock',user:{id:'11111111-1111-4111-8111-111111111111'}}}})},
      functions:{invoke:async()=>({data:{status:'fresh',changed:false},error:null})},
      rpc:async(_name,{action,payload}={})=>{
        window.__economyCalls.push(action);
        const state={id:'11111111-1111-4111-8111-111111111111',name:'Test',gp:wallet,items:[],market:[],
          pulls:readyCollection?{boss_0:{count:1,first:stamp}}:{},
          daily:!claimedDaily,nextDailyAt:claimedDaily?dailyNext:null,serverTime:new Date().toISOString()};
        const results={catalog,cases,state,reward_batch:null,showcase:{name:'Test',items:[]}};
        if(Object.prototype.hasOwnProperty.call(results,action))
          return {data:results[action],error:null};
        if(action==='economy_status')return {data:board(),error:null};
        if(action==='daily'){
          if(claimedDaily)return {data:null,error:{message:'Already claimed'}};
          claimedDaily=true;wallet+=50000;return {data:{},error:null};
        }
        if(action==='economy_recover'){
          if(!board().recovery.available)return {data:null,error:{message:'Not eligible'}};
          claimedRecovery=true;wallet+=5000;return {data:board(),error:null};
        }
        if(action==='economy_claim'){
          if(payload?.code!=='boss:first'||!readyCollection||claimedMilestone)
            return {data:null,error:{message:'Already claimed'}};
          claimedMilestone=true;wallet+=2000;return {data:board(),error:null};
        }
        return {data:{},error:null};
      }
    })};
  },{gp,daily,pending,readyCollection});
  await page.goto('/');
  await page.locator('#games .game-card').click();
  await page.getByRole('button',{name:'Earn GP'}).click();
  await expect(page.locator('.earn-dashboard .earn-milestone')).toHaveCount(1);
  return errors;
}

test('low GP recovery and milestone bonuses are independently claimable once',async({page})=>{
  const errors=await setup(page,{gp:0,daily:false});
  await expect(page.locator('#balance')).toHaveText('0 GP');
  await expect(page.locator('[data-act="earn-daily"]')).toBeDisabled();
  await expect(page.locator('[data-act="earn-recover"]')).toBeEnabled();
  await expect(page.locator('[data-act="earn-milestone"]')).toBeEnabled();
  await page.locator('[data-act="earn-recover"]').click();
  await expect(page.locator('#balance')).toHaveText('5,000 GP');
  await expect(page.locator('[data-act="earn-recover"]')).toBeDisabled();
  await expect(page.locator('[data-act="earn-milestone"]')).toBeEnabled();
  await page.locator('[data-act="earn-milestone"]').click();
  await expect(page.locator('#balance')).toHaveText('7,000 GP');
  await expect(page.locator('[data-act="earn-milestone"]')).toHaveText('Claimed');
  await expect(page.locator('[data-act="earn-milestone"]')).toBeDisabled();
  const calls=await page.evaluate(()=>window.__economyCalls);
  expect(calls.filter(a=>a==='economy_recover')).toHaveLength(1);
  expect(calls.filter(a=>a==='economy_claim')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('50K daily claim remains independent of recovery and shows a confirmed credit',async({page})=>{
  const errors=await setup(page,{gp:2000,daily:true,readyCollection:false});
  await expect(page.locator('[data-act="earn-daily"]')).toBeEnabled();
  await expect(page.locator('[data-act="earn-recover"]')).toBeDisabled();
  await expect(page.locator('[data-act="earn-milestone"]')).toBeDisabled();
  await page.locator('[data-act="earn-daily"]').click();
  await expect(page.locator('#balance')).toHaveText('52,000 GP');
  await expect(page.locator('[data-act="earn-daily"]')).toBeDisabled();
  await expect(page.locator('#gp-delta-inline')).toContainText('+50,000 GP');
  expect(errors).toEqual([]);
});

test('pending pack blocks recovery even when wallet is below the cheapest pack',async({page})=>{
  const errors=await setup(page,{gp:0,daily:false,pending:true,readyCollection:false});
  await expect(page.locator('[data-act="earn-recover"]')).toBeDisabled();
  await expect(page.locator('[data-act="earn-recover"]')).toHaveText('Finish current pack');
  await expect(page.locator('#balance')).toHaveText('0 GP');
  expect((await page.evaluate(()=>window.__economyCalls)).filter(a=>a==='economy_recover')).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('Earn GP is responsive at narrow phone widths and does not change pack screen',async({page})=>{
  const errors=await setup(page,{gp:500});
  for(const width of [320,375,430]){
    await page.setViewportSize({width,height:812});
    const measures=await page.evaluate(()=>({
      scrollWidth:document.documentElement.scrollWidth,
      viewport:document.documentElement.clientWidth
    }));
    expect(measures.scrollWidth).toBeLessThanOrEqual(measures.viewport+1);
  }
  await page.getByRole('button',{name:'Packs'}).click();
  await expect(page.locator('.premium-categories')).toBeVisible();
  await expect(page.locator('#earn')).toBeHidden();
  expect(errors).toEqual([]);
});
