(()=>{'use strict';
const button=document.getElementById('pwa-install');
if(!button)return;
let deferred=null;
const isStandalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const isApple=()=>/iPad|iPhone|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const isAndroid=()=>/Android/i.test(navigator.userAgent);
function refresh(){button.hidden=isStandalone()||(!deferred&&!isApple()&&!isAndroid());}
function instructions(){
 if(isStandalone())return;
 let dialog=document.getElementById('pwa-install-dialog');
 if(!dialog){
   dialog=document.createElement('dialog');dialog.id='pwa-install-dialog';
   dialog.setAttribute('aria-labelledby','pwa-install-heading');
   dialog.innerHTML='<h2 id="pwa-install-heading">Install Challenger Rips</h2><p id="pwa-install-steps"></p><p>Your inventory and GP stay in your Supabase account. Opening packs requires an internet connection.</p><button type="button">Got it</button>';
   document.body.append(dialog);
   dialog.querySelector('button').addEventListener('click',()=>dialog.close());
 }
 dialog.querySelector('#pwa-install-steps').textContent=isApple()?
 'On iPhone: open in Safari, tap Share, choose Add to Home Screen, enable Open as Web App, and tap Add.':
 isAndroid()?'On Android: open in Chrome, tap the three-dot menu, then select Install app or Add to Home screen.':
 'In Chrome or Edge, use the browser install icon or menu to install this site as an app.';
 if(!dialog.open)dialog.showModal();
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;refresh();});
window.addEventListener('appinstalled',()=>{
 deferred=null;refresh();
 const dialog=document.getElementById('pwa-install-dialog');if(dialog?.open)dialog.close();
});
button.addEventListener('click',async()=>{
 if(isStandalone())return;
 if(!deferred){instructions();return;}
 const prompt=deferred;deferred=null;
 try{
   await prompt.prompt();
   const choice=await prompt.userChoice;
   if(choice?.outcome!=='accepted')instructions();
 }catch(err){console.warn('Install prompt unavailable',err);instructions();}
 refresh();
});
refresh();
if('serviceWorker' in navigator&&(location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){
 window.addEventListener('load',()=>{
   const base=new URL('./',location.href);
   navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.pathname,updateViaCache:'none'})
     .then(reg=>window.addEventListener('pageshow',()=>{reg.update().catch(()=>{});}))
     .catch(err=>console.warn('App service worker unavailable',err));
 });
}
})();