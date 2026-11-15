import {openDB, type DBSchema} from 'idb';
import {zip, unzipSync, strFromU8, strToU8} from 'fflate';
import type {Asset, Project, RecordingSession, RecordingChunk} from './types';
import {uid, clone} from './types';
import {parseScore} from './score';
import {tempoMap, validateAnchors} from './time';

interface DrippingDB extends DBSchema {
  projects:{key:string;value:Project};
  assets:{key:string;value:Asset};
  sessions:{key:string;value:RecordingSession};
  chunks:{key:string;value:RecordingChunk;indexes:{sessionId:string}};
}
const dbPromise=openDB<DrippingDB>('dripping',1,{upgrade(db){
  db.createObjectStore('projects',{keyPath:'id'});db.createObjectStore('assets',{keyPath:'id'});
  db.createObjectStore('sessions',{keyPath:'id'});
  const chunks=db.createObjectStore('chunks',{keyPath:'id'});chunks.createIndex('sessionId','sessionId');
}});
export const listProjects=async()=>(await(await dbPromise).getAll('projects')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
export const getProject=async(id:string)=>(await dbPromise).get('projects',id);
export const getAsset=async(id:string)=>{
  const a=await(await dbPromise).get('assets',id);if(!a)throw Error('找不到项目素材 / Missing project asset');return a;
};
export async function saveProject(project:Project,assets:Asset[]=[]):Promise<void>{
  const db=await dbPromise,tx=db.transaction(['projects','assets'],'readwrite');
  for(const a of assets)await tx.objectStore('assets').put(a);
  await tx.objectStore('projects').put(clone(project));await tx.done;
}
export async function deleteProject(id:string):Promise<void>{
  const db=await dbPromise,p=await db.get('projects',id);if(!p)return;
  const tx=db.transaction(['projects','assets'],'readwrite');
  for(const assetId of p.assetIds)await tx.objectStore('assets').delete(assetId);
  await tx.objectStore('projects').delete(id);await tx.done;
}
export function newProject(name:string):Project {
  const now=new Date().toISOString();return {id:uid(),schemaVersion:1,name,createdAt:now,updatedAt:now,tracks:[],takes:[],assetIds:[],scoreMap:[],speed:1,position:0,selection:null,loop:false,undo:[],redo:[],revision:0};
}
export async function createSession(session:RecordingSession){await(await dbPromise).put('sessions',session);}
export async function saveChunk(sessionId:string,sequence:number,data:Float32Array[]):Promise<void>{
  const db=await dbPromise,tx=db.transaction(['chunks','sessions'],'readwrite');
  const session=await tx.objectStore('sessions').get(sessionId);if(!session)throw Error('Recording session no longer exists');
  await tx.objectStore('chunks').put({id:`${sessionId}:${sequence}`,sessionId,sequence,data});
  session.chunks++;session.frames+=data[0].length;await tx.objectStore('sessions').put(session);await tx.done;
}
export const recoverySessions=async()=>(await dbPromise).getAll('sessions');
export async function readSession(id:string):Promise<{session:RecordingSession;channels:Float32Array[]}>{
  const db=await dbPromise,session=await db.get('sessions',id);if(!session)throw Error('Missing recording session');
  const chunks=(await db.getAllFromIndex('chunks','sessionId',id)).sort((a,b)=>a.sequence-b.sequence);
  if(!chunks.length)throw Error('没有可恢复的录音块 / No completed audio chunks');
  const frames=chunks.reduce((n,c)=>n+c.data[0].length,0),channels=Array.from({length:session.channels},()=>new Float32Array(frames));
  let offset=0;
  chunks.forEach((chunk,i)=>{if(chunk.sequence!==i)throw Error('录音块序列不完整 / Recording chunks are not contiguous');chunk.data.forEach((c,j)=>channels[j].set(c,offset));offset+=chunk.data[0].length;});
  return {session,channels};
}
export async function deleteSession(id:string){
  const db=await dbPromise,tx=db.transaction(['sessions','chunks'],'readwrite');
  const keys=await tx.objectStore('chunks').index('sessionId').getAllKeys(id);
  for(const key of keys)await tx.objectStore('chunks').delete(key);
  await tx.objectStore('sessions').delete(id);await tx.done;
}
const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))).map(n=>n.toString(16).padStart(2,'0')).join('');
type PackageAsset={id:string;name:string;type:string;path:string;sha256:string;sampleRate?:number;frames?:number;channels?:number};
export async function exportProject(project:Project):Promise<Blob>{
  const entries:Record<string,Uint8Array>={},assets:PackageAsset[]=[];let size=0;
  for(const id of project.assetIds){
    const asset=await getAsset(id),bytes=new Uint8Array(await asset.blob.arrayBuffer());size+=bytes.length;
    if(size>512*1024*1024)throw Error('项目包超过 512 MB，请先单独导出录音 / Project package exceeds 512 MB');
    const path=`assets/${id}`;entries[path]=bytes;
    assets.push({id,name:asset.name,type:asset.type,path,sha256:await sha256(bytes),sampleRate:asset.sampleRate,frames:asset.frames,channels:asset.channels});
  }
  entries['manifest.json']=strToU8(JSON.stringify({format:'dripping.project',version:1,project,assets}));
  const data=await new Promise<Uint8Array>((resolve,reject)=>zip(entries,{level:0},(e,result)=>e?reject(e):resolve(result)));
  return new Blob([data as Uint8Array<ArrayBuffer>],{type:'application/zip'});
}

function checkProject(p:Project,assetIds:Set<string>){
  if(p.schemaVersion!==1||!Array.isArray(p.tracks)||!Array.isArray(p.takes)||!Array.isArray(p.assetIds))throw Error('不支持的项目格式 / Unsupported project format');
  for(const id of p.assetIds)if(!assetIds.has(id))throw Error('项目缺少素材 / Incomplete project assets');
  const checkTrack=(t:Project['tracks'][number])=>{
    const sourceValid=t.sourceAssetId!==undefined?assetIds.has(t.sourceAssetId):t.role==='recording'&&Array.isArray(t.clips)&&t.clips.length===0;
    if(!Array.isArray(t.clips)||!Number.isFinite(t.offset)||!Number.isFinite(t.volume)||!Number.isFinite(t.pan)||!sourceValid)throw Error('无效音轨 / Invalid track');
    for(const c of t.clips)if(!assetIds.has(c.assetId)||![c.start,c.end,c.sourceStart,c.rate,c.gain,c.fadeIn,c.fadeOut].every(Number.isFinite)||c.end<=c.start||c.sourceStart<0||c.rate<.25||c.rate>4)throw Error('无效片段 / Invalid clip');
    if(t.alignment)validateAnchors(t.alignment.anchors);
  };
  p.tracks.forEach(checkTrack);
  for(const command of [...(p.undo||[]),...(p.redo||[])]){command.before.tracks.forEach(checkTrack);command.after.tracks.forEach(checkTrack);}
  if(p.scoreMap.length)validateAnchors(p.scoreMap);
  if(p.takes.some(t=>!assetIds.has(t.assetId)))throw Error('项目缺少录音 / Missing take asset');
  if(!(p.speed>=.5&&p.speed<=1.5))throw Error('无效练习速度 / Invalid speed');
}

export async function importProject(file:Blob):Promise<Project>{
  if(file.size>512*1024*1024)throw Error('项目包超过 512 MB / Project archive is too large');
  let total=0,count=0;
  const entries=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:info=>{
    if(++count>2000||info.name.startsWith('/')||info.name.split('/').includes('..'))throw Error('不安全的项目包 / Unsafe archive');
    total+=info.originalSize;if(total>512*1024*1024)throw Error('项目解压后过大 / Archive exceeds expanded size limit');return true;
  }});
  if(!entries['manifest.json'])throw Error('没有项目清单 / Missing project manifest');
  const manifest=JSON.parse(strFromU8(entries['manifest.json'])) as {format:string;version:number;project:Project;assets:PackageAsset[]};
  if(manifest.format!=='dripping.project'||manifest.version!==1||!Array.isArray(manifest.assets))throw Error('不支持的项目版本 / Unsupported project version');
  checkProject(manifest.project,new Set(manifest.assets.map(a=>a.id)));
  const project=clone(manifest.project),oldToNew=new Map<string,string>();project.id=uid();
  const assets:Asset[]=[];
  for(const item of manifest.assets){
    const bytes=entries[item.path];if(!bytes||await sha256(bytes)!==item.sha256)throw Error('项目素材校验失败 / Asset checksum mismatch');
    const id=uid();oldToNew.set(item.id,id);
    assets.push({id,projectId:project.id,name:item.name,type:item.type,blob:new Blob([bytes as Uint8Array<ArrayBuffer>],{type:item.type}),sampleRate:item.sampleRate,frames:item.frames,channels:item.channels});
  }
  const remap=(tracks:Project['tracks'])=>tracks.forEach(t=>{if(t.sourceAssetId!==undefined)t.sourceAssetId=oldToNew.get(t.sourceAssetId)!;t.clips.forEach(c=>c.assetId=oldToNew.get(c.assetId)!);});
  project.assetIds=project.assetIds.map(id=>oldToNew.get(id)!);remap(project.tracks);
  for(const command of [...project.undo,...project.redo]){remap(command.before.tracks);remap(command.after.tracks);}
  project.takes.forEach(t=>t.assetId=oldToNew.get(t.assetId)!);
  if(project.scoreAssetId)project.scoreAssetId=oldToNew.get(project.scoreAssetId);
  if(project.scoreXml){project.score=parseScore(project.scoreXml,project.score?.partId);if(!project.scoreMap.length)project.scoreMap=tempoMap(project.score);}
  project.updatedAt=new Date().toISOString();project.name+=' · restored';
  await saveProject(project,assets);return project;
}

export function download(blob:Blob,name:string):void{
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
