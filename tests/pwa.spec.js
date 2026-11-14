import {test,expect} from '@playwright/test';

async function visit(page){
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>
    route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.goto('/');
}
test('PWA manifest resolves to the GitHub Pages subdirectory and uses real PNGs',async({request})=>{
  const response=await request.get('/manifest.json');
  expect(response.ok()).toBe(true);
  const m=await response.json();
  expect(m.name).toBe('Challenger Rips');
  expect(m.display).toBe('standalone');
  const base='https://zeuxidamus1.github.io/blackjack/manifest.json';
  expect(new URL(m.start_url,base).pathname).toBe('/blackjack/');
  expect(new URL(m.scope,base).pathname).toBe('/blackjack/');
  for(const [name,size] of [
    ['icon-192.png',192],['icon-512.png',512],
    ['icon-maskable-512.png',512],['apple-touch-icon.png',180]]){
    const r=await request.get('/icons/'+name);
    expect(r.ok()).toBe(true);
    const data=await r.body();
    expect(data.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(data.readUInt32BE(16)).toBe(size);
    expect(data.readUInt32BE(20)).toBe(size);
  }
});
test('service worker registers and stays scoped to its site',async({page})=>{
  await visit(page);
  await expect(page.getByRole('heading',{name:'Challenger Rips'})).toBeVisible();
  const scope=await page.evaluate(async()=>{
    const reg=await navigator.serviceWorker.ready;
    return new URL(reg.scope).pathname;
  });
  expect(scope).toBe('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href','./manifest.json');
});
test('Android install button uses browser installation prompt',async({page})=>{
  await visit(page);
  await page.evaluate(()=>{
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.prompt=()=>{window.__installTriggered=true;return Promise.resolve();};
    event.userChoice=Promise.resolve({outcome:'accepted'});
    window.dispatchEvent(event);
  });
  const button=page.getByRole('button',{name:'Install Challenger Rips app'});
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(()=>page.evaluate(()=>window.__installTriggered)).toBe(true);
});
test('iPhone gives Safari Add to Home Screen instructions without an APK',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{
    configurable:true,get:()=>'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1'
  }));
  await visit(page);
  const button=page.getByRole('button',{name:'Install Challenger Rips app'});
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByRole('dialog',{name:'Install Challenger Rips'})).toContainText('Add to Home Screen');
  await expect(page.getByRole('dialog',{name:'Install Challenger Rips'})).toContainText('Open as Web App');
});
test('mobile install control does not cause sideways page overflow',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{
    configurable:true,get:()=>'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36'
  }));
  await visit(page);
  await expect(page.getByRole('button',{name:'Install Challenger Rips app'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
});
test('offline navigation shows safe notice and does not expose fake offline game',async({page,context})=>{
  await visit(page);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading',{name:"You're offline"})).toBeVisible();
  await expect(page.getByText(/remain safely stored in Supabase/)).toBeVisible();
  await context.setOffline(false);
});