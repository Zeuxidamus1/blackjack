import {test,expect} from '@playwright/test';

/* All GP writes in this suite run against local mocks. They do not alter Supabase. */
async function setup(page,{moderator=true,mobile=false}={}){
  if(mobile)await page.setViewportSize({width:375,height:812});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:''
  }));
  await page.route('https://static.runelite.net/**',route=>route.fulfill({
    status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64')
  }));
  await page.route('https://prices.runescape.wiki/**',route=>route.fulfill({
    status:200,contentType:'application/json',body:'{"data":{}}'
  }));
  await page.addInitScript(opts=>{
    let backend=JSON.parse(sessionStorage.getItem('mod-suite-state')||'null')||
      {gp:5000,audit:[],requests:{},isModerator:opts.moderator,signedIn:true};
    const persist=()=>sessionStorage.setItem('mod-suite-state',JSON.stringify(backend));
    window.__modFixture=backend;
    const ok=data=>({data,error:null});
    const fail=message=>({data:null,error:{message}});
    const role=()=>backend.isModerator?
      {isModerator:true,canAddGp:true,role:'moderator',maxPerGrant:1000000000,
       history:[...backend.audit].slice(-8).reverse()}:
      {isModerator:false,canAddGp:false};
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:backend.signedIn?{access_token:'mock',user:{id:'mock-user'}}:null},error:null}),
        signOut:async()=>{backend.signedIn=false;persist();return {error:null};}
      },
      functions:{invoke:async()=>({data:{status:'fresh',changed:false},error:null})},
      rpc:async(_fn,{action,payload}={})=>{
        if(!backend.signedIn)return fail('Sign in first.');
        if(action==='state')return ok({
          id:'11111111-1111-4111-8111-111111111111',
          name:backend.isModerator?'zeuxidamus':'regular-test-account',
          gp:backend.gp,items:[],market:[],pulls:{},
          nextDailyAt:new Date(Date.now()+86400000).toISOString(),
          serverTime:new Date().toISOString()
        });
        if(action==='catalog')return ok([{
          id:'boss_1',pack:'boss',name:'Rune scimitar',
          guide:15000,ge:1333,guideTime:new Date().toISOString(),
          weight:1000000,total:1000000,found:0,circulation:0
        }]);
        if(action==='cases')return ok([{
          id:'boss-starter',pack:'boss',name:'Starter Loot',price:1000,
          theme:'bronze',accent:'#bd834d',symbol:'⚔',
          rewards:[{id:'boss_1',weight:1000000,chase:false}]
        }]);
        if(action==='reward_batch')return ok(null);
        if(action==='moderator_status')return ok(role());
        if(action==='moderator_gp_add'){
          if(!backend.isModerator)return fail('Moderator access required.');
          if(payload?.target||payload?.owner||payload?.user_id)
            return fail('You can only adjust your own balance.');
          const amount=Number(payload?.amount);
          if(!Number.isSafeInteger(amount)||amount<1||amount>1000000000)
            return fail('Invalid GP amount.');
          const request=String(payload?.request||'');
          if(!request)return fail('Missing request.');
          if(backend.requests[request]){
            if(backend.requests[request].amount!==amount)return fail('Request already used.');
            return ok({applied:false,amount,newBalance:backend.requests[request].newBalance,alreadyProcessed:true});
          }
          const before=backend.gp;
          backend.gp+=amount;
          const response={applied:true,amount,previousBalance:before,newBalance:backend.gp};
          backend.requests[request]=response;
          backend.audit.push({amount,balanceAfter:backend.gp,createdAt:new Date().toISOString()});
          persist();
          return ok(response);
        }
        return ok(null);
      }
    })};
  },{moderator});
  await page.goto('/');
  await expect(page.locator('#games [data-act="game"][data-id="runescape"]')).toBeVisible();
  await page.locator('#games [data-act="game"][data-id="runescape"]').click();
  return errors;
}

test('Moderator tools are visible only to the authenticated moderator',async({page})=>{
  const errors=await setup(page,{moderator:true});
  const tab=page.getByRole('button',{name:'Moderator Tools'});
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(page.getByRole('heading',{name:'Moderator Console'})).toBeVisible();
  await expect(page.getByText('Account: zeuxidamus')).toBeVisible();
  await expect(page.locator('.mod-current-gp')).toHaveText('5,000 GP');
  await expect(page.locator('.mod-add-card')).toContainText('1,000,000,000 GP per adjustment');
  expect(errors).toEqual([]);
});

test('Moderator can add a custom GP amount with confirmation, live feedback and audit history',async({page})=>{
  const errors=await setup(page,{moderator:true});
  await page.getByRole('button',{name:'Moderator Tools'}).click();
  await page.locator('#mod-gp-amount').fill('1234567');
  page.once('dialog',dialog=>{
    expect(dialog.message()).toContain('1,234,567 GP');
    expect(dialog.message()).toContain('zeuxidamus');
    return dialog.accept();
  });
  await page.locator('[data-act="mod-gp-add"]').click();
  await expect(page.locator('#balance')).toHaveText('1,239,567 GP');
  await expect(page.locator('.mod-current-gp')).toHaveText('1,239,567 GP');
  await expect(page.locator('#gp-delta-inline')).toHaveText('+1,234,567 GP');
  await expect(page.locator('.mod-history-row')).toHaveCount(1);
  await expect(page.locator('.mod-history-row')).toContainText('+1,234,567 GP');
  await expect(page.locator('.mod-history-row')).toContainText('1,239,567 GP');
  const state=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('mod-suite-state')));
  expect(state.audit).toHaveLength(1);
  expect(state.gp).toBe(1239567);
  expect(errors).toEqual([]);
});

test('Preset adds GP to only the moderator wallet and persists across reloads',async({page})=>{
  const errors=await setup(page,{moderator:true});
  await page.getByRole('button',{name:'Moderator Tools'}).click();
  await page.locator('[data-act="mod-preset"][data-id="1000000"]').click();
  await expect(page.locator('#mod-gp-amount')).toHaveValue('1000000');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('[data-act="mod-gp-add"]').click();
  await expect(page.locator('#balance')).toHaveText('1,005,000 GP');
  await page.reload();
  await page.locator('#games [data-act="game"][data-id="runescape"]').click();
  await page.getByRole('button',{name:'Moderator Tools'}).click();
  await expect(page.locator('.mod-current-gp')).toHaveText('1,005,000 GP');
  await expect(page.locator('.mod-history-row')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Forged moderator action is denied to a normal account even through direct RPC',async({page})=>{
  const errors=await setup(page,{moderator:false});
  await expect(page.locator('[data-view="moderator"]')).toBeHidden();
  await expect(page.locator('#moderator')).toBeHidden();
  const attempt=await page.evaluate(async()=>{
    const api=window.supabase.createClient();
    return api.rpc('rips_command',{
      action:'moderator_gp_add',payload:{
        amount:1000000000,request:'11111111-1111-4111-8111-111111111111',role:'moderator'
      }
    });
  });
  expect(attempt.error?.message).toContain('Moderator access required');
  await expect(page.locator('#balance')).toHaveText('5,000 GP');
  const state=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('mod-suite-state')||'null'));
  expect(state).toBeNull();
  expect(errors).toEqual([]);
});

test('Moderator panel rejects invalid, negative and excessive GP inputs',async({page})=>{
  const errors=await setup(page,{moderator:true});
  await page.getByRole('button',{name:'Moderator Tools'}).click();
  for(const amount of ['0','-100','1000000001','1.5']){
    await page.locator('#mod-gp-amount').fill(amount);
    await page.locator('[data-act="mod-gp-add"]').click();
    await expect(page.locator('#balance')).toHaveText('5,000 GP');
    await expect(page.locator('#status')).toContainText('Enter a whole GP amount');
  }
  const attempt=await page.evaluate(async()=>window.supabase.createClient().rpc('rips_command',{
    action:'moderator_gp_add',payload:{amount:123,request:'r',target:'another-user'}
  }));
  expect(attempt.error?.message).toContain('only adjust your own');
  expect(errors).toEqual([]);
});

test('Moderator cannot replay the same request ID to obtain duplicate GP',async({page})=>{
  const errors=await setup(page,{moderator:true});
  const responses=await page.evaluate(async()=>{
    const client=window.supabase.createClient();
    const payload={amount:10000,request:'99999999-9999-4999-8999-999999999999'};
    return Promise.all([
      client.rpc('rips_command',{action:'moderator_gp_add',payload}),
      client.rpc('rips_command',{action:'moderator_gp_add',payload})
    ]);
  });
  expect(responses[0].data.applied).toBe(true);
  expect(responses[1].data.applied).toBe(false);
  const state=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('mod-suite-state')));
  expect(state.gp).toBe(15000);
  expect(state.audit).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Moderator tools stay usable at a mobile phone width',async({page})=>{
  const errors=await setup(page,{moderator:true,mobile:true});
  await page.getByRole('button',{name:'Moderator Tools'}).click();
  await expect(page.locator('#mod-gp-amount')).toBeVisible();
  await expect(page.locator('[data-act="mod-gp-add"]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
  expect(errors).toEqual([]);
});

test('Signing out removes the moderator controls from view',async({page})=>{
  const errors=await setup(page,{moderator:true});
  await page.getByRole('button',{name:'Moderator Tools'}).click();
  await page.locator('[data-act="logout"]').click();
  await expect(page.locator('[data-view="moderator"]')).toBeHidden();
  await expect(page.locator('#moderator')).toBeHidden();
  expect(errors).toEqual([]);
});
