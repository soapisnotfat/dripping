import {readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
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
const policy="default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
await writeFile('dist/index.html',index.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${policy}">`));
const paths=(await files('dist')).filter(p=>p!=='_headers');
const hash=createHash('sha256');
for(const p of paths)hash.update(await readFile('dist/'+p));
const cache='dripping-'+hash.digest('hex').slice(0,12);
await writeFile('dist/sw.js',`const PREFIX='dripping-'+encodeURIComponent(new URL(self.registration.scope).pathname)+'-',CACHE=PREFIX+${JSON.stringify(cache)},FILES=${JSON.stringify(paths)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(p=>new URL(p,self.registration.scope).href)))));
self.addEventListener('message',e=>{if(e.data==='ACTIVATE_UPDATE')self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).catch(()=>e.request.mode==='navigate'?caches.match(new URL('index.html',self.registration.scope).href):Response.error())))});
`);
console.log('Offline cache:',cache,paths.length,'files');
