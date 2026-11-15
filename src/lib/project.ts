import type {Project,Asset,TrackRole,PCM,Track,RecordingSession} from './types';
import {clone,uid} from './types';
import {parseScore,readScoreFile} from './score';
import {tempoMap,projectDuration} from './time';
import {saveProject,getAsset,readSession,deleteSession} from './storage';
import {transport} from './transport';
import {encodeWav,clearClips,splitClips,trimClips} from './audio';
import {audioJobs} from './jobs';

export type ImportItem={file:File;role:TrackRole|'score'};
export function guessRole(name:string):ImportItem['role']{
  if(/\.(xml|musicxml|mxl)$/i.test(name))return 'score';
  return /demo|示范|示範|演奏|performance|reference/i.test(name)?'demo':'backing';
}
export function audioAsset(project:Project,pcm:PCM,name:string):Asset{
  return {id:uid(),projectId:project.id,name,type:'audio/wav',blob:new Blob([encodeWav(pcm,32)],{type:'audio/wav'}),sampleRate:pcm.sampleRate,frames:pcm.channels[0].length,channels:pcm.channels.length};
}
export async function addFiles(project:Project,items:ImportItem[],progress:(text:string)=>void):Promise<Project>{
  const p=clone(project),assets:Asset[]=[];
  if(items.filter(i=>i.role==='score').length>1)throw Error('每个项目请选一份乐谱 / Choose one score per project');
  if(p.score&&items.some(i=>i.role==='score'))throw Error('请为另一份乐谱建立新项目 / Create a new project for another score');
  for(const {file,role} of items){
    progress(file.name);
    if(file.size>160*1024*1024)throw Error('单个文件请小于 160 MB / Keep each file below 160 MB');
    const asset:Asset={id:uid(),projectId:p.id,name:file.name,type:file.type||'application/octet-stream',blob:file};
    if(role==='score'){
      const xml=await readScoreFile(file),score=parseScore(xml);p.scoreXml=xml;p.score=score;p.scoreAssetId=asset.id;p.scoreMap=tempoMap(score);
    }else{
      const pcm=await transport.decode(file);
      if(pcm.channels.length>2)throw Error('音轨需为单声道或立体声 / Audio tracks must be mono or stereo');
      const duration=pcm.channels[0].length/pcm.sampleRate;if(duration>900)throw Error('单轨暂支持 15 分钟以内 / Maximum track duration is 15 minutes');
      asset.sampleRate=pcm.sampleRate;asset.frames=pcm.channels[0].length;asset.channels=pcm.channels.length;
      transport.pcm.set(asset.id,pcm);
      p.tracks.push({id:uid(),name:file.name.replace(/\.[^.]+$/,''),role,sourceAssetId:asset.id,volume:role==='demo'?.7:.8,pan:0,mute:role==='demo',solo:false,offset:0,color:p.tracks.length%4,
        clips:[{id:uid(),assetId:asset.id,label:file.name,start:0,end:duration,sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0}]});
    }
    assets.push(asset);p.assetIds.push(asset.id);
  }
  p.updatedAt=new Date().toISOString();p.revision++;await saveProject(p,assets);return p;
}
export function editProject(project:Project,label:string,mutate:(p:Project)=>void):Project{
  const p=clone(project),snapshot=()=>({tracks:clone(p.tracks),selection:clone(p.selection),scoreMap:clone(p.scoreMap),referenceTrackId:p.referenceTrackId}),before=snapshot();mutate(p);
  p.undo.push({label,before,after:snapshot()});if(p.undo.length>60)p.undo.shift();p.redo=[];return p;
}
export function addRecordingTrack(project:Project,name:string):Project{
  return editProject(project,'add recording track',p=>{
    p.tracks.push({id:uid(),name,role:'recording',volume:.85,pan:0,mute:false,solo:false,offset:0,color:2,clips:[]});
  });
}
export function editSelection(project:Project,action:'split'|'clear'|'trim'|'fade',trackId:string):Project{
  if(!project.selection)throw Error('先选择一个片段 / Select a passage first');
  const selection=project.selection;
  return editProject(project,action,p=>{
    const t=p.tracks.find(t=>t.id===trackId);if(!t)throw Error('选择要编辑的音轨 / Choose a track');
    const a=selection.start-t.offset,b=selection.end-t.offset;
    t.clips=action==='clear'?clearClips(t.clips,a,b):action==='trim'?trimClips(t.clips,a,b):splitClips(t.clips,a,b);
    if(action==='fade')for(const c of t.clips)if(c.start>=a-1e-7&&c.end<=b+1e-7){c.fadeIn=Math.min(.08,(c.end-c.start)/4);c.fadeOut=c.fadeIn;}
  });
}
export async function finishTake(project:Project,sessionId:string,interrupted=false):Promise<Project>{
  if(project.takes.some(t=>t.id===sessionId)){await deleteSession(sessionId);return clone(project);}
  const {session,channels}=await readSession(sessionId),pcm={sampleRate:session.sampleRate,channels};
  const asset=audioAsset(project,pcm,`${session.name}.wav`),duration=channels[0].length/session.sampleRate;
  const rawStart=session.start-session.latencyMs/1000*session.speed,start=Math.max(0,rawStart),end=rawStart+duration*session.speed;
  const sourceStart=Math.max(0,-rawStart)/session.speed;
  const p=editProject(project,'record',p=>{
    let track=p.tracks.find(t=>t.id===session.trackId);
    if(!track){track={id:session.trackId,name:session.name,role:'recording',sourceAssetId:asset.id,volume:.85,pan:0,mute:false,solo:false,offset:0,color:2,clips:[]};p.tracks.push(track);}
    track.sourceAssetId ??= asset.id;
    // Punch replacement is non-destructive. Every original take remains in p.takes.
    if(end>start){
      track.clips=clearClips(track.clips,start-track.offset,end-track.offset);
      track.clips.push({id:uid(),assetId:asset.id,label:session.name,start:start-track.offset,end:end-track.offset,sourceStart,rate:1/session.speed,gain:1,fadeIn:.005,fadeOut:.005});
    }
    track.clips.sort((a,b)=>a.start-b.start);
  });
  p.assetIds.push(asset.id);p.takes.push({id:session.id,name:session.name,assetId:asset.id,trackId:session.trackId,start:rawStart,end,speed:session.speed,sampleRate:session.sampleRate,channels:session.channels,createdAt:session.createdAt,inputLabel:session.inputLabel,latencyMs:session.latencyMs,interrupted});
  p.updatedAt=new Date().toISOString();p.revision++;await saveProject(p,[asset]);await deleteSession(sessionId);transport.pcm.set(asset.id,pcm);return p;
}
export function newRecordingSession(project:Project,trackId:string,start:number,sampleRate:number,channels:number,inputLabel:string,latencyMs:number):RecordingSession{
  return {id:uid(),projectId:project.id,trackId,name:`Take ${project.takes.length+1}`,start,speed:project.speed,sampleRate,channels,createdAt:new Date().toISOString(),inputLabel,latencyMs,chunks:0,frames:0};
}
export async function renderExport(project:Project,track:Track,from=0,to=projectDuration(project),mixed=false):Promise<PCM>{
  const buffers=await Promise.all([...new Set(track.clips.map(c=>c.assetId))].map(async id=>[id,await transport.asset(id)]));
  return audioJobs.run<PCM>('render',{track,buffers,from,to,sampleRate:48000,speed:1,mixed});
}
export async function originalTake(assetId:string){return (await getAsset(assetId)).blob;}
