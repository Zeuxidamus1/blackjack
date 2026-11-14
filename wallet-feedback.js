/* Challenger Rips wallet feedback.
   GP changes are displayed only after Supabase has returned the updated balance.
   No client-side balance changes are ever persisted or used to decide purchases. */
(()=>{
 'use strict';
 const balance=document.getElementById('balance');
 if(!balance)return;
 const wrap=balance.parentElement;
 const inline=document.createElement('span');
 inline.id='gp-delta-inline';
 inline.className='gp-delta-inline';
 inline.hidden=true;
 inline.setAttribute('role','status');
 inline.setAttribute('aria-live','polite');
 inline.setAttribute('aria-atomic','true');
 wrap.appendChild(inline);

 const floating=document.createElement('div');
 floating.id='gp-wallet-live';
 floating.hidden=true;
 floating.innerHTML='<span class="gp-wallet-label">GP Balance</span>'+
   '<strong class="gp-wallet-total"></strong>'+
   '<span class="gp-wallet-change" aria-live="polite" aria-atomic="true" hidden></span>';
 document.body.appendChild(floating);
 const total=floating.querySelector('.gp-wallet-total');
 const change=floating.querySelector('.gp-wallet-change');
 const nf=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
 let timer=null;
 const valid=(n)=>Number.isSafeInteger(n)&&n>=0;
 const formatted=(n)=>nf.format(n)+' GP';
 function sync(value){
   const n=Number(value);
   if(!valid(n)){
     floating.hidden=true;
     return;
   }
   balance.textContent=formatted(n);
   total.textContent=formatted(n);
   floating.hidden=false;
 }
 function clear(){
   clearTimeout(timer);
   timer=null;
   inline.hidden=true;
   change.hidden=true;
   inline.className='gp-delta-inline';
   change.className='gp-wallet-change';
 }
 function record(previous,next,kind){
   const before=Number(previous),after=Number(next);
   if(!valid(before)||!valid(after))return false;
   sync(after);
   const delta=after-before;
   if(delta===0 || (kind==='purchase' && delta>=0) ||
       (kind==='sell' && delta<=0))return false;
   const text=(delta>0?'+':'−')+formatted(Math.abs(delta));
   const klass=delta>0?'gp-positive':'gp-negative';
   clear();
   inline.textContent=text;
   change.textContent=text;
   inline.className='gp-delta-inline '+klass+' gp-pop';
   change.className='gp-wallet-change '+klass+' gp-pop';
   inline.hidden=false;
   change.hidden=false;
   timer=window.setTimeout(clear,4000);
   return true;
 }
 function reset(){
   clear();
   floating.hidden=true;
 }
 window.ChallengerWallet={sync,record,reset};
})();