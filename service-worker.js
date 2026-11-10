const CACHE_NAME='duck-minh-quan-pwa-v2';
const APP_ROOT=new URL('./',self.location.href);
const APP_FILES=[
  './',
  './index.html',
  './manifest.webmanifest',
  './style.css?v=30',
  './game.js?v=28',
  './pwa.js',
  './supabase-config.js?v=1',
  './assets/duck-logo.png',
  './assets/duck-welcome.png',
  './assets/duck-3d-crystal-world.svg',
  './assets/app-icon-192.png',
  './assets/app-icon-512.png',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('duck-minh-quan-pwa-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.endsWith('/assets/background-music.mp3'))return;

  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok)void caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
      return response;
    }).catch(async()=>{
      const cached=await caches.match(request);
      return cached||caches.match(APP_ROOT.href);
    }));
    return;
  }

  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok&&response.type==='basic')void caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
    return response;
  })));
});
