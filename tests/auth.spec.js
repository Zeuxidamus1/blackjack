import {test,expect} from '@playwright/test';

const transparentPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64');

async function setup(page,{signedIn=false,wrongUsername=false,wrongEmail=false,path='/'}={}){
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.route('https://static.runelite.net/**',r=>r.fulfill({status:200,contentType:'image/png',body:transparentPng}));
  await page.route('https://prices.runescape.wiki/**',r=>r.fulfill({status:200,contentType:'application/json',body:'{"data":{}}'}));
  await page.addInitScript(({signedIn,wrongUsername,wrongEmail})=>{
    const account={access_token:'test-token',refresh_token:'test-refresh',user:{id:'11111111-1111-4111-8111-111111111111'}};
    let session=signedIn?account:null;
    window.__authEvents=[];
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session},error:null}),
        onAuthStateChange:callback=>{window.__authEvent=callback;return {data:{subscription:{unsubscribe(){}}}};},
        signUp:async({email})=>{window.__authEvents.push(['signup',email]);session=account;return {data:{session},error:null};},
        signInWithPassword:async({email,password})=>{
          window.__authEvents.push(['email-login',email,password.length]);
          if(wrongEmail)return {data:{session:null},error:{code:'invalid_credentials',message:'Bad credentials'}};
          session=account;return {data:{session},error:null};
        },
        setSession:async()=>{window.__authEvents.push(['set-session']);session=account;return {data:{session},error:null};},
        resetPasswordForEmail:async(email,options)=>{
          window.__authEvents.push(['request-reset',email,options.redirectTo]);return {error:null,data:{}};
        },
        updateUser:async({password})=>{
          window.__authEvents.push(['update-password',password.length]);return {data:{user:account.user},error:null};
        },
        signOut:async()=>{session=null;return {error:null};}
      },
      functions:{invoke:async(name,{body}={})=>{
        window.__authEvents.push(['edge-login',name,body?.username]);
        if(name==='challenger-login'){
          if(wrongUsername)return {data:null,error:{context:{status:401},message:'Rejected'}};
          return {data:{access_token:'test-token',refresh_token:'test-refresh'},error:null};
        }
        return {data:{status:'fresh',changed:false},error:null};
      }},
      rpc:async(_,{action}={})=>{
        const now=new Date().toISOString();
        const catalog=[{id:'boss_0',pack:'boss',weight:100,ge:4151,name:'Abyssal whip',guide:5000,guideTime:now,found:0,circulation:0,salvage:0}];
        const cases=[{id:'boss-starter',pack:'boss',name:'Starter Loot',price:1000,theme:'bronze',accent:'#ce834d',symbol:'⚔',description:'Starter rewards',rewards:[{id:'boss_0',weight:1000000000000}]}];
        const state={id:account.user.id,name:'Test',gp:100000,items:[],market:[],pulls:{},serverTime:now,nextDailyAt:new Date(Date.now()+86400000).toISOString()};
        return {data:{catalog,cases,state,reward_batch:null}[action]??null,error:null};
      }
    })};
  },{signedIn,wrongUsername,wrongEmail});
  await page.goto(path);
  if(signedIn)await expect(page.locator('#login-screen')).toBeHidden();
  else await expect(page.locator('#login-screen')).toBeVisible();
  return errors;
}

test('existing username/password login still uses the protected username endpoint',async({page})=>{
  const errors=await setup(page);
  await page.locator('#auth [name="username"]').fill('test_player');
  await page.locator('#auth [name="password"]').fill('correct-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  const events=await page.evaluate(()=>window.__authEvents);
  expect(events).toContainEqual(['edge-login','challenger-login','test_player']);
  expect(events.some(e=>e[0]==='email-login')).toBe(false);
  expect(events).toContainEqual(['set-session']);
  expect(errors).toEqual([]);
});

test('desktop can sign in using account email without username lookup',async({page})=>{
  const errors=await setup(page);
  await page.locator('#auth [name="username"]').fill('Player@Example.COM');
  await page.locator('#auth [name="password"]').fill('correct-password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  const events=await page.evaluate(()=>window.__authEvents);
  expect(events).toContainEqual(['email-login','player@example.com',16]);
  expect(events.some(e=>e[0]==='edge-login'&&e[1]==='challenger-login')).toBe(false);
  expect(errors).toEqual([]);
});

test('bad credentials show a recovery option and password visibility can toggle',async({page})=>{
  const errors=await setup(page,{wrongUsername:true});
  await page.locator('#auth [name="username"]').fill('test_player');
  await page.locator('#auth [name="password"]').fill('correct-password');
  await page.locator('#auth-show-password').click();
  await expect(page.locator('#auth [name="password"]')).toHaveAttribute('type','text');
  await page.locator('#auth-show-password').click();
  await expect(page.locator('#auth [name="password"]')).toHaveAttribute('type','password');
  await page.locator('#auth-submit').click();
  await expect(page.locator('#status')).toContainText('reset your password');
  await expect(page.locator('#auth-forgot')).toBeVisible();
  await expect(page.locator('#login-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('password reset request sends to registered email with app callback and no account reset',async({page})=>{
  const errors=await setup(page);
  await page.locator('#auth-forgot').click();
  await expect(page.locator('#auth')).toBeHidden();
  await expect(page.locator('#auth-recovery-request')).toBeVisible();
  await page.locator('#auth-recovery-request [name="email"]').fill('Player@Example.com');
  await page.locator('#auth-recovery-request button[type="submit"]').click();
  await expect(page.locator('#login-screen .login-card > #status')).toContainText('Check your inbox');
  const events=await page.evaluate(()=>window.__authEvents);
  const reset=events.find(e=>e[0]==='request-reset');
  expect(reset[1]).toBe('player@example.com');
  expect(reset[2]).toBe(new URL('/',page.url()).href);
  expect(events.some(e=>e[0]==='update-password')).toBe(false);
  await page.locator('#auth-recovery-back').click();
  await expect(page.locator('#auth')).toBeVisible();
  expect(errors).toEqual([]);
});

test('recovery link prompts for a matching new password and updates only account password',async({page})=>{
  const errors=await setup(page,{signedIn:true,path:'/#type=recovery'});
  const dialog=page.locator('#password-recovery-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[name="password"]').fill('new-strong-password');
  await dialog.locator('[name="confirm"]').fill('mismatch-password');
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator('#recovery-status')).toContainText('do not match');
  expect((await page.evaluate(()=>window.__authEvents)).some(e=>e[0]==='update-password')).toBe(false);
  await dialog.locator('[name="confirm"]').fill('new-strong-password');
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog).toBeHidden();
  const events=await page.evaluate(()=>window.__authEvents);
  expect(events.filter(e=>e[0]==='update-password')).toHaveLength(1);
  expect(new URL(page.url()).hash).toBe('');
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  expect(errors).toEqual([]);
});

test('signup retains restricted username rules and does not accept email in username field',async({page})=>{
  const errors=await setup(page);
  await page.locator('#auth-mode').click();
  await expect(page.locator('#auth-identifier-text')).toHaveText('Username');
  await expect(page.locator('#auth [name="username"]')).toHaveAttribute('pattern','[A-Za-z0-9_]{3,24}');
  await expect(page.locator('#auth-forgot')).toBeHidden();
  await page.locator('#auth-mode').click();
  await expect(page.locator('#auth-identifier-text')).toHaveText('Username or email');
  expect(await page.locator('#auth [name="username"]').evaluate(input=>input.hasAttribute('pattern'))).toBe(false);
  await expect(page.locator('#auth-forgot')).toBeVisible();
  await page.locator('#auth [name="username"]').fill('test_player');
  await page.locator('#auth [name="password"]').fill('correct-password');
  expect(await page.locator('#auth [name="username"]').evaluate(input=>input.checkValidity())).toBe(true);
  await page.locator('#auth-submit').click();
  await expect(page.locator('#balance')).toHaveText('100,000 GP');
  expect(errors).toEqual([]);
});
