import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const source=new URL('../vendor/sheetscan/',import.meta.url),cache=new URL('../.cache/sheetscan/',import.meta.url);
const pin=JSON.parse(await readFile(new URL('pin.json',source),'utf8')),target=new URL('../public/vendor/sheetscan/'+pin.version+'/',import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(cache,{recursive:true});await mkdir(target,{recursive:true});
for(const [name,hash] of Object.entries(pin.files)){
  let bytes=await readFile(new URL(name,source));if(sha(bytes)!==hash)throw Error('SheetScan vendored checksum mismatch: '+name);
  if(name==='sheetscan.js'){
    // PDF.js library mode embeds its worker as a data URL. Serve the exact
    // decoded worker from this origin, keeping executable data URLs out of CSP.
    const text=bytes.toString(),pattern=/"data:text\/javascript;base64,([A-Za-z0-9+/=]+)"/;const match=text.match(pattern);
    if(!match)throw Error('Pinned PDF.js worker not found');
    await mkdir(new URL('assets/',target),{recursive:true});await writeFile(new URL('assets/pdf.worker.mjs',target),Buffer.from(match[1],'base64'));
    bytes=Buffer.from(text.replace(pattern,"new URL('./assets/pdf.worker.mjs',import.meta.url).href"));
  }
  const file=new URL(name,target);await mkdir(new URL('.',file),{recursive:true});await writeFile(file,bytes);
}
await mkdir(new URL('models/',target),{recursive:true});
for(const model of pin.models){
  const cached=new URL(model.sha256+'.onnx',cache);let bytes;try{bytes=await readFile(cached);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(bytes&&sha(bytes)!==model.sha256)throw Error('Cached model checksum mismatch: '+model.name);
  if(!bytes){
    console.log('Downloading pinned recognition model:',model.name);let archive;
    for(let attempt=0;attempt<3;attempt++)try{const response=await fetch(model.url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw Error('HTTP '+response.status);archive=new Uint8Array(await response.arrayBuffer());break;}catch(error){if(attempt===2)throw error;}
    if(sha(archive)!==model.archiveSha256)throw Error('Model archive checksum mismatch: '+model.name);
    const entries=unzipSync(archive,{filter:entry=>entry.name.endsWith('.onnx')});const names=Object.keys(entries);if(names.length!==1)throw Error('Expected one ONNX in model archive');bytes=entries[names[0]];
    if(sha(bytes)!==model.sha256)throw Error('Recognition model checksum mismatch: '+model.name);
    const temporary=new URL(model.sha256+'.partial',cache);await writeFile(temporary,bytes);await writeFile(cached,bytes);await rm(temporary,{force:true});
  }
  await writeFile(new URL('models/'+model.name+'.onnx',target),bytes);
}
await writeFile(new URL('pin.json',target),JSON.stringify(pin,null,2)+'\n');
console.log('Pinned SheetScan prepared:',pin.version);
