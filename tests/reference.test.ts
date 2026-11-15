import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {referencePCM} from '../src/lib/reference';
import {newProject} from '../src/lib/storage';
import type {Score} from '../src/lib/types';

function rms(samples:Float32Array,rate:number,from:number,to:number){
  let power=0,count=0;
  for(let i=Math.round(from*rate);i<Math.round(to*rate);i++){power+=samples[i]**2;count++;}
  return Math.sqrt(power/count);
}
function partial(samples:Float32Array,rate:number,frequency:number){
  const from=Math.round(.1*rate),length=Math.round(.2*rate);let re=0,im=0;
  for(let i=0;i<length;i++){
    const value=samples[from+i]*(.5-.5*Math.cos(2*Math.PI*i/(length-1))),phase=2*Math.PI*frequency*(from+i)/rate;
    re+=value*Math.cos(phase);im+=value*Math.sin(phase);
  }
  return Math.hypot(re,im);
}
it('gives piano a percussive decay and flute a sustained note at the same pitch',()=>{
  const project=newProject('Synth timbre');
  project.score={totalQ:1,events:[{q:.05,duration:.5,midi:72,voice:'1',staff:1}]} as Score;
  project.scoreMap=[{q:0,seconds:0},{q:1,seconds:1}];
  const flute=referencePCM(project,'flute'),piano=referencePCM(project,'piano'),sr=flute.sampleRate;
  const decay=(s:Float32Array)=>rms(s,sr,.4,.47)/rms(s,sr,.1,.17);
  expect(decay(piano.channels[0])).toBeLessThan(.55);
  expect(decay(flute.channels[0])).toBeGreaterThan(.9);
  const brightness=(s:Float32Array)=>partial(s,sr,523.251*2)/partial(s,sr,523.251);
  expect(brightness(piano.channels[0])).toBeGreaterThan(brightness(flute.channels[0])*3);
  for(const pcm of [flute,piano]){
    expect(pcm.channels[0]).toHaveLength(sr);
    expect(pcm.channels[0].every(v=>Number.isFinite(v)&&Math.abs(v)<1)).toBe(true);
    expect(rms(pcm.channels[0],sr,.1,.17)).toBeGreaterThan(.03);
  }
});
