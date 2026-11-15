import {test,expect} from '@playwright/test';

const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64');
async function setup(page,{gp=0,daily=false,pending=false,readyCollection=true,startView='earn'}={}){
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
  await page.locator('[data-view="'+startView+'"]').click();
  if(startView==='collection')await expect(page.locator('#collection-milestones [data-act="earn-milestone"]')).toHaveCount(1);
  else{
    await expect(page.locator('.earn-quick')).toHaveCount(2);
    await expect(page.locator('#earn .earn-milestone')).toHaveCount(0);
  }
  return errors;
}

test('low GP recovery and milestone bonuses are independently claimable once',async({page})=>{
  const errors=await setup(page,{gp:0,daily:false});
  await expect(page.locator('#balance')).toHaveText('0 GP');
  await expect(page.locator('[data-act="earn-daily"]')).toBeDisabled();
  await expect(page.locator('[data-act="earn-recover"]')).toBeEnabled();
  await expect(page.locator('#earn [data-act="earn-milestone"]')).toHaveCount(0);
  await page.locator('[data-act="earn-recover"]').click();
  await expect(page.locator('#balance')).toHaveText('5,000 GP');
  await expect(page.locator('[data-act="earn-recover"]')).toBeDisabled();
  await expect(page.locator('[data-act="earn-recover"]')).toHaveText('Claimed');
  await expect(page.locator('[data-countdown="recovery"]')).toContainText('Next available claim in');
  await expect(page.locator('[data-countdown="recovery"] strong')).toContainText(/^23:59:/);
  await page.locator('[data-view="collection"]').click();
  const milestone=page.locator('#collection-milestones [data-act="earn-milestone"]');
  await expect(milestone).toBeEnabled();
  await milestone.click();
  await expect(page.locator('#balance')).toHaveText('7,000 GP');
  await expect(page.locator('#collection-milestones [data-act="earn-milestone"]')).toHaveCount(0);
  await expect(page.locator('#collection-milestones .collection-rewards-complete').first()).toContainText('All rewards claimed');
  await expect(page.locator('#collection .collection-goal')).toHaveCount(3);
  const calls=await page.evaluate(()=>window.__economyCalls);
  expect(calls.filter(a=>a==='economy_recover')).toHaveLength(1);
  expect(calls.filter(a=>a==='economy_claim')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('50K daily claim remains independent of recovery and shows a confirmed credit',async({page})=>{
  const errors=await setup(page,{gp:2000,daily:true,readyCollection:false});
  await expect(page.locator('[data-act="earn-daily"]')).toBeEnabled();
  await expect(page.locator('[data-act="earn-recover"]')).toBeDisabled();
  await expect(page.locator('#earn [data-act="earn-milestone"]')).toHaveCount(0);
  await page.locator('[data-act="earn-daily"]').click();
  await expect(page.locator('#balance')).toHaveText('52,000 GP');
  await expect(page.locator('[data-act="earn-daily"]')).toBeDisabled();
  await expect(page.locator('[data-countdown="daily"]')).toContainText('Next available claim in');
  await expect(page.locator('[data-countdown="daily"] strong')).toContainText(/^23:59:/);
  await expect(page.locator('#gp-delta-inline')).toContainText('+50,000 GP');
  expect(errors).toEqual([]);
});

test('pending pack blocks recovery even when wallet is below the cheapest pack',async({page})=>{
  const errors=await setup(page,{gp:0,daily:false,pending:true,readyCollection:false});
  await expect(page.locator('[data-act="earn-recover"]')).toBeDisabled();
  await expect(page.locator('[data-act="earn-recover"]')).toHaveText('Finish current pack');
  await expect(page.locator('[data-countdown="recovery"]')).toBeHidden();
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
  await expect(page.locator('.earn-quick')).toHaveCount(2);
  await expect(page.locator('.earn-quick-title').first()).toHaveText('Daily GP');
  await expect(page.locator('.earn-quick-title').last()).toHaveText('Bonus GP');
  await expect(page.locator('.earn-dashboard')).not.toContainText('Low-balance recovery');
  await expect(page.locator('.earn-dashboard')).not.toContainText('Available below');
  await expect(page.locator('#earn')).not.toContainText('Milestone rewards');
  await expect(page.locator('#earn [data-act="earn-milestone"]')).toHaveCount(0);
  await page.locator('[data-view="collection"]').click();
  await expect(page.locator('.collection-reward-group')).toHaveCount(3);
  await expect(page.locator('#collection-milestones [data-act="earn-milestone"]')).toHaveCount(1);
  await page.locator('#filter').selectOption('clue');
  await expect(page.locator('.collection-reward-group')).toHaveCount(1);
  await expect(page.locator('.collection-reward-group')).toContainText('Clue Casket');
  await expect(page.locator('#collection-milestones [data-act="earn-milestone"]')).toHaveCount(0);
  await page.locator('.collection-goal[data-id="boss"]').click();
  await expect(page.locator('#filter')).toHaveValue('boss');
  await expect(page.locator('.collection-reward-group')).toContainText('Boss Loot');
  await expect(page.locator('#collection-milestones [data-act="earn-milestone"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Packs'}).click();
  await expect(page.locator('.premium-categories')).toBeVisible();
  await expect(page.locator('#earn')).toBeHidden();
  expect(errors).toEqual([]);
});


test('countdowns use server clock offset and advance without rebuilding the page',async({page})=>{
  const errors=await setup(page,{gp:0,daily:false});
  const values=await page.evaluate(()=>{
    const now=Date.now();
    const board={
      dailyAmount:50000,minimumPackPrice:1000,
      recovery:{amount:5000,available:false,balanceTooHigh:false,pendingPack:false,
        nextAt:new Date(now+7300).toISOString()},
      milestones:[]
    };
    const state={gp:0,daily:false,nextDailyAt:new Date(now+7300).toISOString()};
    const root=document.getElementById('earn-dashboard');
    const economy=window.ChallengerEconomy;
    economy.tick(root,board,state,1000,now);
    const earlier={
      daily:root.querySelector('[data-countdown="daily"] strong').textContent,
      recovery:root.querySelector('[data-countdown="recovery"] strong').textContent
    };
    economy.tick(root,board,state,1000,now+3000);
    const later={
      daily:root.querySelector('[data-countdown="daily"] strong').textContent,
      recovery:root.querySelector('[data-countdown="recovery"] strong').textContent
    };
    economy.tick(root,board,state,1000,now+8000);
    return {earlier,later,
      dailyEnabled:!root.querySelector('[data-act="earn-daily"]').disabled,
      recoveryEnabled:!root.querySelector('[data-act="earn-recover"]').disabled,
      dailyHidden:root.querySelector('[data-countdown="daily"]').hidden,
      recoveryHidden:root.querySelector('[data-countdown="recovery"]').hidden
    };
  });
  expect(values.earlier).toEqual({daily:'00:00:07',recovery:'00:00:07'});
  expect(values.later).toEqual({daily:'00:00:04',recovery:'00:00:04'});
  expect(values.dailyEnabled).toBe(true);
  expect(values.recoveryEnabled).toBe(true);
  expect(values.dailyHidden).toBe(true);
  expect(values.recoveryHidden).toBe(true);
  expect(errors).toEqual([]);
});

test('claim cards stay compact side by side at narrow mobile widths',async({page})=>{
  const errors=await setup(page,{gp:0});
  for(const width of [320,360,390,430]){
    await page.setViewportSize({width,height:812});
    const layout=await page.locator('.earn-quick-grid').evaluate(grid=>{
      const cards=[...grid.querySelectorAll('.earn-quick')].map(el=>el.getBoundingClientRect());
      return {
        firstX:cards[0].x,secondX:cards[1].x,
        firstY:cards[0].y,secondY:cards[1].y,
        maxHeight:Math.max(cards[0].height,cards[1].height),
        documentWidth:document.documentElement.scrollWidth,
        viewport:document.documentElement.clientWidth
      };
    });
    expect(layout.secondX).toBeGreaterThan(layout.firstX);
    expect(Math.abs(layout.secondY-layout.firstY)).toBeLessThan(1);
    expect(layout.maxHeight).toBeLessThanOrEqual(190);
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport+1);
  }
  expect(errors).toEqual([]);
});

test('claimed milestones remain hidden in Collection Log, with unclaimed progress preserved',async({page})=>{
  const errors=await setup(page,{gp:0,readyCollection:true});
  const data=await page.evaluate(()=>{
    const economy=window.ChallengerEconomy;
    const milestones=[
      {code:'boss:first',pack:'boss',title:'First find',goal:1,found:1,amount:2000,available:false,claimed:true},
      {code:'boss:scout',pack:'boss',title:'Scout',goal:10,found:4,amount:5000,available:false,claimed:false},
      {code:'clue:first',pack:'clue',title:'First find',goal:1,found:1,amount:2000,available:true,claimed:false}
    ];
    const board={dailyAmount:50000,recovery:{amount:5000,available:false},milestones};
    const packs=[{id:'boss',name:'Boss Loot',icon:'⚔️'},
      {id:'clue',name:'Clue Casket',icon:'🧰'},
      {id:'pets',name:'Pet Hunt',icon:'🐾'}];
    return {
      boss:economy.renderMilestones(board,packs,'boss'),
      clue:economy.renderMilestones(board,packs,'clue'),
      all:economy.renderMilestones(board,packs,'all'),
      earn:economy.render(board,{gp:0,daily:false},packs)
    };
  });
  expect(data.boss).not.toContain('data-id="boss:first"');
  expect(data.boss).toContain('data-id="boss:scout"');
  expect(data.boss).toContain('4 / 10 unique items');
  expect(data.clue).toContain('data-id="clue:first"');
  expect(data.clue).not.toContain('data-id="boss:scout"');
  expect(data.all).toContain('data-id="boss:scout"');
  expect(data.all).toContain('data-id="clue:first"');
  expect(data.earn).not.toContain('Milestone rewards');
  expect(data.earn).not.toContain('earn-milestone');
  expect(errors).toEqual([]);
});

test('Collection Log loads claimable milestones directly and credits once',async({page})=>{
  const errors=await setup(page,{gp:0,startView:'collection'});
  await expect(page.locator('#collection-milestones')).toContainText('Milestone rewards');
  await expect(page.locator('.collection-rewards-heading')).toContainText('1 ready to claim');
  await expect(page.locator('#balance')).toHaveText('0 GP');
  await page.locator('#collection-milestones [data-act="earn-milestone"]').click();
  await expect(page.locator('#balance')).toHaveText('2,000 GP');
  await expect(page.locator('#collection-milestones [data-act="earn-milestone"]')).toHaveCount(0);
  await page.locator('[data-view="earn"]').click();
  await expect(page.locator('.earn-quick')).toHaveCount(2);
  await expect(page.locator('#earn')).not.toContainText('Milestone rewards');
  const calls=await page.evaluate(()=>window.__economyCalls);
  expect(calls.filter(a=>a==='economy_claim')).toHaveLength(1);
  expect(errors).toEqual([]);
});
