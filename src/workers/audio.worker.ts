/// <reference lib="webworker" />
import {audioFeatures,alignToScore,alignToDemo,conformAudio} from '../lib/alignment';
import {renderTrack,stretchAudio,resamplePCM} from '../lib/audio';
import type {PCM} from '../lib/types';
import {measureExport,masterWav} from '../lib/master';

self.onmessage=({data})=>{
  const {id,kind,payload}=data;
  try {
    let result:unknown;
    if(kind==='features')result=audioFeatures(payload.samples,payload.sampleRate,payload.hop);
    else if(kind==='align')result=alignToScore(payload.score,payload.features);
    else if(kind==='align-demo')result=alignToDemo(payload.score,payload.demo,payload.demoMap,payload.features);
    else if(kind==='conform')result=conformAudio(payload.pcm,payload.sourceMap,payload.targetMap,payload.duration,payload.score,payload.manualAnchors);
    else if(kind==='stretch')result=stretchAudio(payload.pcm,payload.speed);
    else if(kind==='resample')result=resamplePCM(payload.pcm,payload.sampleRate,payload.frames);
    else if(kind==='render')result=renderTrack(payload.track,new Map(payload.buffers),payload.from,payload.to,payload.sampleRate,payload.speed,payload.mixed);
    else if(kind==='measure-export')result=measureExport(payload.pcm);
    else if(kind==='master-wav')result=masterWav(payload.pcm,payload.stats,payload.settings,payload.bitDepth);
    else throw Error('Unknown audio task');
    const transfer=(result as {wav?:ArrayBuffer})?.wav?[(result as {wav:ArrayBuffer}).wav]:(result as PCM)?.channels?.map(c=>c.buffer as ArrayBuffer) || [];
    self.postMessage({id,result},transfer);
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
