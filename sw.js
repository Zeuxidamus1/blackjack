/* Network-first app navigation; no caching of Supabase or authenticated data. */
const NAME='challenger-rips-shell-20261115-v19', PREFIX='challenger-rips-shell-';
const BASE=new URL(self.registration.scope),OFFLINE=new URL('offline.html',BASE).href;
const ASSETS=['offline.html','manifest.json','app-install.js','reveal.js','reveal.css','motion.css','progression.js','progression.css','economy.js','economy.css','missions.js','missions.css','premium-packs.css','inventory-step5.css','moderator.js','moderator.css','wallet-feedback.js','wallet-feedback.css','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon.png'];
const ASSET_PATHS=new Set(ASSETS.map(p=>new URL(p,BASE).pathname));
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(NAME);await cache.addAll(ASSETS.map(p=>new URL(p,BASE).href));await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==NAME).map(k=>caches.delete(k)));await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);if(url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
 if(req.mode==='navigate'){
   event.respondWith(fetch(req,{cache:'no-store'}).catch(async()=>await caches.match(OFFLINE)||new Response('Challenger Rips requires a connection.',{status:503})));return;
 }
 if(!ASSET_PATHS.has(url.pathname))return;
 event.respondWith((async()=>{
   const cache=await caches.open(NAME);
   try{const result=await fetch(req,{cache:'no-cache'});if(result.ok)await cache.put(req,result.clone());return result;}
   catch{return await cache.match(req)||await cache.match(new URL(url.pathname,BASE.origin).href)||Response.error();}
 })());
});