import {test,expect} from '@playwright/test';

const tinyPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64');

async function setup(page,{signedIn=true,signupHasSession=true,path='/',width=375,pendingConfirmed=false}={}){
  await page.setViewportSize({width,height:812});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.route('https://static.runelite.net/**',route=>route.fulfill({status:200,contentType:'image/png',body:tinyPng}));
  await page.route('https://prices.runescape.wiki/**',route=>route.fulfill({status:200,contentType:'application/json',body:'{"data":{}}'}));
  await page.addInitScript(({signedIn,signupHasSession,pendingConfirmed})=>{
    if(pendingConfirmed)sessionStorage.setItem('challenger-rips-pending-onboarding','playwright');
    const account={access_token:'mock',user:{id:'11111111-1111-4111-8111-111111111111'}};
    let session=signedIn?account:null;
    window.__navigationCalls=[];
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session},error:null}),
        signUp:async()=>{window.__navigationCalls.push('signup');session=signupHasSession?account:null;return {data:{session},error:null};},
        setSession:async()=>{session=account;return {data:{session},error:null};},
        signOut:async()=>{session=null;return {error:null};}
      },
      functions:{invoke:async(name)=>({data:name==='challenger-login'?{access_token:'mock',refresh_token:'mock'}:{status:'fresh',changed:false},error:null})},
      rpc:async(_name,{action}={})=>{
        window.__navigationCalls.push(action);
        const now=new Date().toISOString();
        const catalog=[{id:'boss_0',pack:'boss',weight:100,ge:4151,name:'Abyssal whip',guide:1000000,guideTime:now,found:0,circulation:0,salvage:0}];
        const cases=[{id:'boss-starter',pack:'boss',name:'Starter Loot',price:1000,theme:'bronze',accent:'#ce834d',symbol:'⚔',description:'Starter prizes',rewards:[{id:'boss_0',weight:1000000000000}]}];
        const state={id:account.user.id,name:'Playwright',gp:100000,items:[],market:[],pulls:{},serverTime:now,nextDailyAt:new Date(Date.now()+86400000).toISOString()};
        const values={catalog,cases,state,reward_batch:null,showcase:{name:'Friend',items:[]}};
        return {data:values[action]??null,error:null};
      }
    })};
  },{signedIn,signupHasSession,pendingConfirmed});
  await page.goto(path);
  return errors;
}
async function signUp(page){
  await page.locator('#auth-mode').click();
  await page.locator('#auth [name="username"]').fill('brandnew');
  await page.locator('#auth [name="email"]').fill('brandnew@example.com');
  await page.locator('#auth [name="password"]').fill('test-secret-strong');
  await page.locator('#auth-submit').click();
}
test('new account gets mocked 100K GP and lands in Choose your adventure, not Boss Loot',async({page})=>{
  const errors=await setup(page,{signedIn:false});
  await expect(page.locator('#login-screen')).toBeVisible();
  await signUp(page);
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  await expect(page.locator('#shop .premium-categories h2')).toHaveText('Choose your adventure');
  await expect(page.locator('#shop .premium-category')).toHaveCount(3);
  await expect(page.locator('#shop .boss-carousel')).toHaveCount(0);
  await expect(page.locator('#games')).toBeHidden();
  await expect(page.locator('#game-navigation')).toBeVisible();
  expect(await page.evaluate(()=>window.__navigationCalls.filter(x=>x==='signup'))).toHaveLength(1);
  expect(errors).toEqual([]);
});
test('new account with pending email confirmation sees category overview after first sign-in',async({page})=>{
  const errors=await setup(page,{signedIn:false,signupHasSession:false});
  await signUp(page);
  await expect(page.locator('#login-screen')).toBeVisible();
  await expect(page.locator('#status')).toContainText('Check your email');
  await page.locator('#auth [name="username"]').fill('brandnew');
  await page.locator('#auth [name="password"]').fill('test-secret-strong');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  await expect(page.locator('#shop .premium-categories h2')).toHaveText('Choose your adventure');
  expect(errors).toEqual([]);
});
test('confirmed signup returns to categories on first authenticated page load',async({page})=>{
  const errors=await setup(page,{signedIn:true,pendingConfirmed:true});
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  await expect(page.locator('#shop .premium-categories h2')).toHaveText('Choose your adventure');
  await expect(page.locator('#games')).toBeHidden();
  await page.reload();
  await expect(page.locator('#games .game-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('returning session starts on single RuneScape game card and resets to Games on reload',async({page})=>{
  const errors=await setup(page);
  await expect(page.locator('#games .game-card')).toHaveCount(1);
  await expect(page.locator('#games [data-act="game"][data-id="runescape"]')).toBeVisible();
  await expect(page.locator('nav.tabs')).toBeHidden();
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  await page.locator('#games .game-card').click();
  await expect(page.locator('#shop .premium-categories h2')).toHaveText('Choose your adventure');
  await expect(page.locator('#shop .premium-category')).toHaveCount(3);
  await expect(page.locator('#shop .boss-carousel')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#games .game-card')).toHaveCount(1);
  await expect(page.locator('#shop')).toBeHidden();
  expect(errors).toEqual([]);
});
test('Collection Log has only the small header Sign out button',async({page})=>{
  const errors=await setup(page,{width:375});
  await page.locator('#games .game-card').click();
  await page.getByRole('button',{name:'Collection log'}).click();
  await expect(page.locator('#collection')).toBeVisible();
  await expect(page.locator('#account')).toHaveCount(0);
  await expect(page.locator('[data-act="logout"]')).toHaveCount(1);
  await expect(page.locator('header .header-signout')).toBeVisible();
  await expect(page.locator('header .header-signout')).toHaveText('Sign out');
  expect(errors).toEqual([]);
});
test('RuneScape, Boss Loot, categories and All games navigate without economy actions',async({page})=>{
  const errors=await setup(page);
  await page.locator('#games .game-card').click();
  await expect(page.locator('#shop .premium-categories h2')).toHaveText('Choose your adventure');
  await expect(page.locator('#shop .premium-category')).toHaveCount(3);
  await expect(page.locator('#shop .boss-carousel')).toHaveCount(0);
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  await page.locator('[data-act="category"][data-id="boss"]').click();
  await expect(page.locator('#boss-details h2')).toHaveText('Starter Loot');
  await expect(page.locator('#shop')).not.toContainText('Mystery Collectibles');
  await expect(page.locator('#shop')).not.toContainText('Swipe to discover your next treasure');
  await expect(page.locator('#shop')).not.toContainText('Digital GP only');
  await expect(page.locator('#shop')).not.toContainText('Drag or swipe to browse');
  const back=page.locator('.boss-top [data-act="categories"]');
  await expect(back).toHaveText('← Explore Packs');
  await back.click();
  await expect(page.locator('.premium-category')).toHaveCount(3);
  await page.locator('[data-act="category"][data-id="clue"]').click();
  await expect(page.locator('.other-case-heading h2')).toHaveText('Clue Casket');
  await page.locator('[data-act="categories"]').click();
  await expect(page.locator('.premium-category')).toHaveCount(3);
  await page.locator('[data-act="all-games"]').click();
  await expect(page.locator('#games .game-card')).toHaveCount(1);
  await expect(page.locator('nav.tabs')).toBeHidden();
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  const calls=await page.evaluate(()=>window.__navigationCalls);
  expect(calls).not.toContain('case_purchase');
  expect(calls).not.toContain('sell');
  expect(errors).toEqual([]);
});
test('compact Boss Loot back button does not wrap or overflow on Android and iPhone widths',async({page})=>{
  const errors=await setup(page);
  await page.locator('#games .game-card').click();
  await expect(page.locator('.premium-category')).toHaveCount(3);
  await page.locator('[data-act="category"][data-id="boss"]').click();
  const back=page.locator('.boss-top [data-act="categories"]');
  for(const width of [320,375,390,430]){
    await page.setViewportSize({width,height:812});
    const layout=await back.evaluate(button=>{
      const bounds=button.getBoundingClientRect();
      return {right:bounds.right,left:bounds.left,height:bounds.height,whitespace:getComputedStyle(button).whiteSpace,bodyWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth};
    });
    expect(layout.whitespace).toBe('nowrap');
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(width);
    expect(layout.height).toBeLessThanOrEqual(51);
    expect(layout.bodyWidth).toBeLessThanOrEqual(width+1);
  }
  expect(errors).toEqual([]);
});
test('shared showroom deep link still opens shared view instead of Games',async({page})=>{
  const errors=await setup(page,{path:'/?shelf=11111111-1111-4111-8111-111111111111'});
  await expect(page.locator('#shared')).toBeVisible();
  await expect(page.locator('#games')).toBeHidden();
  await expect(page.locator('#shared')).toContainText('Friend');
  expect(errors).toEqual([]);
});
