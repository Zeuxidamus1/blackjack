import {test,expect} from '@playwright/test';

const ITEM_VALUES=[12000,22000,36000,49000,66000];
const mockCatalog=ITEM_VALUES.map((value,i)=>({
  id:'test_item_'+i,pack:'boss',weight:2000,ge:1115+i,
  name:['Rune scimitar','Dragon platelegs','Abyssal whip','Dragon boots','Bandos tassets'][i],
  guide:value,guideTime:new Date().toISOString(),
  salvage:0,found:0,circulation:0
}));
const boss={
  id:'boss-starter',pack:'boss',name:'Starter Loot',price:1000,
  theme:'bronze',accent:'#d28e4a',symbol:'⚔',description:'Starter prizes',
  rewards:mockCatalog.map((v,i)=>({id:v.id,weight:i===4?992000:2000,chase:i===0})),
  configVersion:2
};
async function setup(page,{gp=100000,viewport}={}){
  if(viewport)await page.setViewportSize(viewport);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.jsdelivr.net/npm/@supabase/**',route=>route.fulfill({
    status:200,contentType:'application/javascript',body:''
  }));
  await page.route('https://static.runelite.net/**',route=>route.fulfill({
    status:200,contentType:'image/png',
    body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WpJwA8AAAAASUVORK5CYII=','base64')
  }));
  await page.addInitScript(({mockCatalog,boss,gp})=>{
    const id='11111111-1111-4111-8111-111111111111';
    const now=new Date().toISOString();
    let backend=JSON.parse(sessionStorage.getItem('reveal-mock')||'null')||
      {gp,inventory:[],batch:null,purchases:0,settlements:0};
    const save=()=>sessionStorage.setItem('reveal-mock',JSON.stringify(backend));
    const snapshot=()=>{
      const b=backend.batch;if(!b)return null;
      return {id:b.id,case:b.case,quantity:b.quantity,paid:b.paid,
        remaining:b.rewards.filter(r=>r.status==='pending').length,
        rewards:b.rewards.map(r=>({
          slot:r.slot,revealed:r.revealed,status:r.status,
          item:r.revealed?r.item:null,
          instance:r.revealed&&r.status==='pending'?r.instance:null,
          value:r.revealed?mockCatalog.find(c=>c.id===r.item).guide:null,
          settledValue:r.settledValue??null,
          priceUpdated:r.revealed?now:null
        }))
      };
    };
    window.supabase={createClient:()=>({
      auth:{
        getSession:async()=>({data:{session:{access_token:'test-session'}}}),
        signOut:async()=>({error:null})
      },
      functions:{invoke:async()=>({data:{status:'fresh'},error:null})},
      rpc:async(_method,{action,payload}={})=>{
        const ok=data=>({data,error:null});
        const fail=msg=>({data:null,error:{message:msg}});
        if(action==='catalog')return ok(mockCatalog);
        if(action==='cases')return ok([boss]);
        if(action==='state')return ok({
          id,name:'Playwright Tester',gp:backend.gp,
          items:backend.inventory.filter(i=>i.status==='vaulted')
            .map(i=>({id:i.instance,item:i.item,pinned:false,pulled:true,listing:i.listing||null,salvage:0})),
          market:[],pulls:{},nextDailyAt:now,serverTime:now
        });
        if(action==='sell_bulk'){
          const ids=payload?.ids;
          if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length)
            return fail('Invalid bulk sale selection');
          const owned=ids.map(id=>backend.inventory.find(i=>i.instance===id && i.status==='vaulted'));
          if(owned.some(item=>!item || item.listing))return fail('One or more selected items are unavailable');
          if(window.__mockRejectBulkSale){
            window.__mockRejectBulkSale=false;
            return fail('Server rejected the sale; inventory unchanged.');
          }
          const total=owned.reduce((sum,item)=>sum+mockCatalog.find(c=>c.id===item.item).guide,0);
          owned.forEach(item=>item.status='sold');
          backend.gp+=total;
          backend.bulkSales=(backend.bulkSales||0)+1;
          save();
          return ok({count:ids.length,total});
        }
        if(action==='reward_batch')return ok(backend.batch &&
          (payload?.batch||backend.batch.rewards.some(r=>r.status==='pending'))?snapshot():null);
        if(action==='case_purchase'){
          const qty=payload?.quantity;
          if(!Number.isInteger(qty)||qty<1||qty>5)return fail('Invalid quantity');
          if(backend.batch?.rewards.some(r=>r.status==='pending'))return fail('Previous rewards pending');
          const cost=boss.price*qty;
          if(cost>backend.gp)return fail('Not enough GP');
          backend.gp-=cost;backend.purchases++;
          backend.batch={id:payload.request,case:boss.id,quantity:qty,paid:cost,
            rewards:Array.from({length:qty},(_,i)=>{
              const item=mockCatalog[i].id,instance=id.slice(0,-1)+(i+1);
              backend.inventory.push({instance,item,status:'pending'});
              return {slot:i+1,item,instance,status:'pending',revealed:false};
            })
          };
          save();
          return ok(snapshot());
        }
        if(action==='reward_reveal'){
          if(!backend.batch||payload?.batch!==backend.batch.id)return fail('Invalid batch');
          for(const r of backend.batch.rewards){
            if(payload.slot==null||payload.slot===r.slot)r.revealed=true;
          }
          save();
          return ok(snapshot());
        }
        if(action==='reward_settle'){
          if(!backend.batch||payload?.batch!==backend.batch.id)return fail('Unknown batch');
          const slots=payload.slots,decision=payload.decision;
          if(!Array.isArray(slots)||!['sell','vault'].includes(decision))return fail('Invalid action');
          const rewards=slots.map(n=>backend.batch.rewards.find(r=>r.slot===n));
          if(rewards.some(r=>!r||r.status!=='pending'||!r.revealed))return fail('Already settled');
          backend.settlements++;
          for(const r of rewards){
            r.status=decision==='sell'?'sold':'vaulted';
            const found=backend.inventory.find(x=>x.instance===r.instance);
            found.status=r.status;
            if(decision==='sell'){
              r.settledValue=mockCatalog.find(c=>c.id===r.item).guide;
              backend.gp+=r.settledValue;
            }
          }
          save();return ok(snapshot());
        }
        return ok(null);
      }
    })};
  },{mockCatalog,boss,gp});
  await page.goto('/');
  await expect(page.locator('#shop.boss-shop .boss-carousel')).toBeVisible();
  await expect(page.locator('#boss-details h2')).toHaveText('Starter Loot');
  return errors;
}
async function purchase(page,qty){
  await page.locator('.boss-qty [data-id="'+qty+'"]').click();
  await page.locator('#boss-details [data-act="purchase"]').click();
  await expect(page.locator('#cr-reveal')).toBeVisible();
  await expect(page.locator('#cr-reveal [data-cr="skip"]')).toBeVisible();
  await page.locator('#cr-reveal [data-cr="skip"]').click();
}
async function revealAll(page,qty){
  await expect(page.locator('#cr-reveal .cr-turn')).toHaveCount(qty);
  await page.locator('#cr-reveal [data-cr="reveal-all"]').click();
  await expect(page.locator('#cr-reveal .cr-result-card')).toHaveCount(qty);
}
test('single opening presents dominant item, exact GP and Sell/Vault',async({page})=>{
  const errors=await setup(page);
  await purchase(page,1);
  await expect(page.locator('.cr-single-name')).toHaveText('Rune scimitar');
  await expect(page.locator('.cr-single-info')).toContainText('12,000 GP');
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  await page.getByRole('button',{name:'Inventory'}).click();
  await expect(page.locator('#owned')).toContainText('Rune scimitar');
  expect(errors).toEqual([]);
});
for(const qty of [2,3,5]){
  test(qty+' packs generate '+qty+' facedown cards then result grid',async({page})=>{
    const errors=await setup(page);
    await purchase(page,qty);
    await revealAll(page,qty);
    await expect(page.locator('.cr-summary-label')).toContainText(qty+' items');
    await page.locator('[data-cr="vault"]').click();
    await expect(page.locator('#cr-reveal')).toBeHidden();
    const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
    expect(backend.batch.rewards).toHaveLength(qty);
    expect(backend.batch.rewards.every(r=>r.status==='vaulted')).toBe(true);
    expect(errors).toEqual([]);
  });
}
test('four-packs: select 2, sell only selected, vault the rest atomically',async({page})=>{
  const errors=await setup(page);
  await purchase(page,4);
  await revealAll(page,4);
  await page.locator('.cr-result-card').nth(0).click();
  await page.locator('.cr-result-card').nth(1).click();
  await expect(page.locator('.cr-summary-label')).toHaveText('2 / 4 items selected');
  await expect(page.locator('.cr-summary-value')).toHaveText('34,000 GP');
  await expect(page.locator('[data-cr="sell"]')).toContainText('SELL (2)');
  await expect(page.locator('.cr-result-card[aria-pressed="true"]')).toHaveCount(2);
  await page.locator('[data-cr="sell"]').click();
  await expect(page.locator('.cr-result-card')).toHaveCount(2);
  await expect(page.locator('[data-cr="vault"]')).toContainText('VAULT ALL');
  await page.locator('[data-cr="vault"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(backend.gp).toBe(100000-4000+12000+22000);
  expect(backend.settlements).toBe(2);
  expect(backend.batch.rewards.map(r=>r.status)).toEqual(['sold','sold','vaulted','vaulted']);
  expect(errors).toEqual([]);
});
test('reload during uncompleted reveal resumes without new purchase',async({page})=>{
  const errors=await setup(page);
  await purchase(page,3);
  await page.locator('.cr-turn').first().click();
  await expect(page.locator('.cr-turn').first()).toHaveClass(/cr-flipped/);
  await page.reload();
  await expect(page.locator('[data-act="resume"]')).toBeVisible();
  await page.locator('[data-act="resume"]').first().click();
  await expect(page.locator('.cr-turn')).toHaveCount(3);
  await expect(page.locator('.cr-turn').first()).toHaveClass(/cr-flipped/);
  await page.locator('[data-cr="reveal-all"]').click();
  await expect(page.locator('.cr-result-card')).toHaveCount(3);
  await page.locator('[data-cr="vault"]').click();
  const backend=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(backend.purchases).toBe(1);
  expect(errors).toEqual([]);
});
test('mobile results remain two-column, safe-area actions and no sideways overflow',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:812}});
  await purchase(page,4);
  await revealAll(page,4);
  const columns=await page.locator('.cr-results-grid').evaluate(el=>
    getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(2);
  const bodyWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(376);
  await expect(page.locator('.cr-actions')).toBeInViewport();
  await page.locator('[data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('five-item mobile results keep the GP wallet above the summary and minimize scrolling',async({page})=>{
  const errors=await setup(page,{viewport:{width:375,height:740}});
  await purchase(page,5);
  await revealAll(page,5);
  await expect(page.locator('#gp-wallet-live')).toBeVisible();
  // Even while a GP credit/debit message is visible, it must not cover the total.
  await page.locator('#gp-wallet-live .gp-wallet-change').evaluate(node=>{
    node.textContent='+12,000 GP';
    node.hidden=false;
  });
  const layout=await page.evaluate(()=>{
    const wallet=document.getElementById('gp-wallet-live').getBoundingClientRect();
    const summary=document.querySelector('.cr-summary').getBoundingClientRect();
    const art=document.querySelector('.cr-result-art').getBoundingClientRect();
    const results=document.querySelector('.cr-results-scroll');
    return {
      walletBottom:wallet.bottom,
      summaryTop:summary.top,
      artHeight:art.height,
      scrollOverhang:results.scrollHeight-results.clientHeight
    };
  });
  expect(layout.walletBottom).toBeLessThanOrEqual(layout.summaryTop);
  expect(layout.artHeight).toBeLessThanOrEqual(133);
  expect(layout.scrollOverhang).toBeLessThanOrEqual(165);
  await expect(page.locator('.cr-actions')).toBeInViewport();
  await page.locator('#cr-reveal [data-cr="vault"]').click();
  expect(errors).toEqual([]);
});
test('Sell All credits validated server prices exactly once',async({page})=>{
  const errors=await setup(page);
  await purchase(page,2);
  await revealAll(page,2);
  await page.locator('[data-cr="sell"]').click();
  await expect(page.locator('#cr-reveal')).toBeHidden();
  const before=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(before.gp).toBe(100000-2000+12000+22000);
  expect(before.settlements).toBe(1);
  await page.reload();
  const after=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
  expect(after.gp).toBe(before.gp);
  expect(after.purchases).toBe(1);
  expect(after.settlements).toBe(1);
  expect(errors).toEqual([]);
});


test('pack purchase shows red real-balance debit, single sale shows green server-credit',async({page})=>{
 const errors=await setup(page);
 await expect(page.locator('#balance')).toHaveText('100,000 GP');
 await purchase(page,1);
 await expect(page.locator('#balance')).toHaveText('99,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveText('−1,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveClass(/gp-negative/);
 await expect(page.locator('#gp-wallet-live')).toContainText('99,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveText('−1,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveClass(/gp-negative/);
 await expect(page.locator('.cr-single-info')).toContainText('12,000 GP');
 await page.locator('[data-cr="sell"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 await expect(page.locator('#balance')).toHaveText('111,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveText('+12,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveClass(/gp-positive/);
 expect(errors).toEqual([]);
});
test('multi-pack purchase debits total and selected sale credits only selected verified rewards',async({page})=>{
 const errors=await setup(page);
 await purchase(page,4);
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveText('−4,000 GP');
 await expect(page.locator('#balance')).toHaveText('96,000 GP');
 await revealAll(page,4);
 await page.locator('.cr-result-card').nth(0).click();
 await page.locator('.cr-result-card').nth(1).click();
 await page.locator('[data-cr="sell"]').click();
 await expect(page.locator('.cr-result-card')).toHaveCount(2);
 await expect(page.locator('#balance')).toHaveText('130,000 GP');
 await expect(page.locator('#gp-wallet-live')).toContainText('130,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveText('+34,000 GP');
 await expect(page.locator('#gp-wallet-live .gp-wallet-change')).toHaveClass(/gp-positive/);
 await page.locator('[data-cr="vault"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 await expect(page.locator('#gp-delta-inline')).toHaveText('+34,000 GP');
 expect(errors).toEqual([]);
});
test('no debit or credit animation on insufficient GP / unsuccessful pack purchase',async({page})=>{
 const errors=await setup(page,{gp:500});
 await expect(page.locator('#balance')).toHaveText('500 GP');
 await expect(page.locator('#boss-details [data-act="purchase"]')).toBeDisabled();
 await expect(page.locator('#gp-delta-inline')).toBeHidden();
 expect(errors).toEqual([]);
});


async function prepareInventory(page,qty=4){
 await purchase(page,qty);
 await revealAll(page,qty);
 await page.locator('[data-cr="vault"]').click();
 await expect(page.locator('#cr-reveal')).toBeHidden();
 await page.getByRole('button',{name:'Inventory'}).click();
 await expect(page.locator('#owned .item')).toHaveCount(qty);
}

test('Inventory multi-select sells only chosen items at confirmed GE prices and credits GP once',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,4);
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#inventory-toolbar')).toBeVisible();
 await page.locator('#owned [data-act="inventory-toggle"]').nth(0).click();
 await page.locator('#owned [data-act="inventory-toggle"]').nth(1).click();
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(2);
 await expect(page.locator('#inventory-toolbar')).toContainText('2 selected');
 await expect(page.locator('#inventory-toolbar')).toContainText('34,000 GP');
 await expect(page.locator('#inventory-toolbar [data-act="inventory-sell"]')).toContainText('Sell selected (2)');
 page.once('dialog',dialog=>dialog.accept());
 await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
 await expect(page.locator('#owned .item')).toHaveCount(2);
 await expect(page.locator('#balance')).toHaveText('130,000 GP');
 await expect(page.locator('#gp-delta-inline')).toHaveText('+34,000 GP');
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(0);
 const result=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(result.bulkSales).toBe(1);
 expect(result.inventory.filter(i=>i.status==='sold')).toHaveLength(2);
 expect(result.inventory.filter(i=>i.status==='vaulted')).toHaveLength(2);
 expect(errors).toEqual([]);
});
test('Select all, clear and selection mode preserve individual inventory actions',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,3);
 await page.locator('#inventory-mode-button').click();
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#owned .is-selected')).toHaveCount(3);
 await expect(page.locator('#inventory-toolbar')).toContainText('70,000 GP');
 await page.locator('#inventory-toolbar [data-act="inventory-clear"]').click();
 await expect(page.locator('#owned .is-selected')).toHaveCount(0);
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#inventory-toolbar')).toBeHidden();
 await expect(page.locator('#owned [data-act="sell"]')).toHaveCount(3);
 expect(errors).toEqual([]);
});
test('Listed inventory items cannot be selected for bulk sale',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,3);
 await page.evaluate(()=>{
   const backend=JSON.parse(sessionStorage.getItem('reveal-mock'));
   backend.inventory[0].listing='11111111-1111-4111-8111-111111111199';
   sessionStorage.setItem('reveal-mock',JSON.stringify(backend));
 });
 await page.reload();
 await page.getByRole('button',{name:'Inventory'}).click();
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#owned .inventory-entry.is-unavailable')).toHaveCount(1);
 await expect(page.locator('#owned .inventory-select-overlay')).toHaveCount(2);
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#owned .is-selected')).toHaveCount(2);
 await expect(page.locator('#inventory-toolbar')).toContainText('58,000 GP');
 expect(errors).toEqual([]);
});
test('Failed atomic bulk sale does not deduct items or change GP, and retry succeeds',async({page})=>{
 const errors=await setup(page);
 await prepareInventory(page,2);
 await page.locator('#inventory-mode-button').click();
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await page.evaluate(()=>{window.__mockRejectBulkSale=true;});
 page.on('dialog',d=>d.accept());
 await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
 await expect(page.locator('#status')).toContainText('Server rejected the sale');
 await expect(page.locator('#balance')).toHaveText('98,000 GP');
 await expect(page.locator('#owned .inventory-entry.is-selected')).toHaveCount(2);
 await expect(page.locator('#owned .item')).toHaveCount(2);
 await page.locator('#inventory-toolbar [data-act="inventory-sell"]').click();
 await expect(page.locator('#balance')).toHaveText('132,000 GP');
 await expect(page.locator('#owned .item')).toHaveCount(0);
 const result=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('reveal-mock')));
 expect(result.bulkSales).toBe(1);
 expect(errors).toEqual([]);
});
test('Inventory multi-select works on a phone width without horizontal overflow',async({page})=>{
 const errors=await setup(page,{viewport:{width:375,height:812}});
 await prepareInventory(page,5);
 await page.locator('#inventory-mode-button').click();
 await expect(page.locator('#inventory-toolbar [data-act="inventory-all"]')).toBeVisible();
 await page.locator('#inventory-toolbar [data-act="inventory-all"]').click();
 await expect(page.locator('#inventory-toolbar')).toContainText('5 selected');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(376);
 expect(errors).toEqual([]);
});
