import {readdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function files(dir,prefix='') {
  const out=[];
  for(const e of await readdir(dir,{withFileTypes:true})) {
    const name=prefix+e.name;
    if(e.isDirectory())out.push(...await files(dir+'/'+e.name,name+'/'));
    else if(name!=='sw.js')out.push(name);
  }
  return out;
}
const index=await readFile('dist/index.html','utf8');
const policy="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
await writeFile('dist/index.html',index.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,'').replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${policy}">`));
// No recognition code, runtime or ONNX weights in ordinary-practice precaching.
const paths=(await files('dist')).filter(p=>p!=='_headers'&&!p.startsWith('vendor/sheetscan/'));
const hash=createHash('sha256');
for(const p of paths)hash.update(await readFile('dist/'+p));
const cache='dripping-'+hash.digest('hex').slice(0,12),pin=JSON.parse(await readFile('vendor/sheetscan/pin.json','utf8'));
await writeFile('dist/sw.js',`const PREFIX='dripping-'+encodeURIComponent(new URL(self.registration.scope).pathname)+'-',CACHE=PREFIX+${JSON.stringify(cache)},DEMAND=PREFIX+${JSON.stringify('score-'+pin.version)},FILES=${JSON.stringify(paths)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(p=>new URL(p,self.registration.scope).href)))));
self.addEventListener('message',e=>{if(e.data==='ACTIVATE_UPDATE')self.skipWaiting()});
// Keep one previous core cache for immutable chunks requested by already-open tabs.
// Current navigation always comes from CACHE, never an arbitrary older index.
self.addEventListener('activate',e=>e.waitUntil((async()=>{
 const keys=await caches.keys(),previous=keys.filter(k=>k.startsWith(PREFIX+'dripping-')&&k!==CACHE).at(-1);
 await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE&&k!==DEMAND&&k!==previous).map(k=>caches.delete(k)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',e=>{
 const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin)return;
 e.respondWith((async()=>{
  const current=await caches.open(CACHE),isRecognition=url.pathname.includes('/vendor/sheetscan/');
  let response=e.request.mode==='navigate'?await current.match(new URL('index.html',self.registration.scope).href):await current.match(e.request);
  if(!response&&isRecognition){
   response=await(await caches.open('omr-assets-v1')).match(e.request,{ignoreSearch:true});
   if(!response)response=await(await caches.open(DEMAND)).match(e.request);
  }
  if(!response&&/\\/assets\\/[^/]+-[\\w-]{6,}\\.(?:js|mjs|css|woff2?)$/.test(url.pathname)){
   const previous=(await caches.keys()).filter(k=>k.startsWith(PREFIX+'dripping-')&&k!==CACHE).at(-1);
   if(previous)response=await(await caches.open(previous)).match(e.request);
  }
  if(!response){
   try{response=await fetch(e.request);}catch{response=e.request.mode==='navigate'?await current.match(new URL('index.html',self.registration.scope).href):Response.error();}
   // The SDK owns validated large-resource caching. Avoid storing a second copy.
   if(response?.ok&&isRecognition&&!/\\/runtime\\/|\\/models\\/|\\/homr\\.zip$/.test(url.pathname)){
    const copy=response.clone();e.waitUntil(caches.open(DEMAND).then(cache=>cache.put(e.request,copy)).catch(()=>{}));
   }
  }
  if(response&&response.status!==0){const headers=new Headers(response.headers);headers.set('Cross-Origin-Opener-Policy','same-origin');headers.set('Cross-Origin-Embedder-Policy','require-corp');return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
  return response||Response.error();
 })());
});
`);
console.log('Offline cache:',cache,paths.length,'files');
