import type {Project,PCM} from './types';
import {projectDuration,qToSeconds,beatGrid} from './time';
import {soundingEvents} from './score';

export function referencePCM(project:Project,instrument:'flute'|'piano'='flute'):PCM {
  const sr=22050,out=new Float32Array(Math.ceil(projectDuration(project)*sr));
  if(project.score)for(const event of soundingEvents(project.score)) {
    const start=Math.max(0,qToSeconds(event.q,project.scoreMap)),end=qToSeconds(event.q+event.duration,project.scoreMap);
    const a=Math.round(start*sr),length=Math.round((end-start)*sr),freq=440*2**((event.midi!-69)/12);
    for(let i=0;i<length&&a+i<out.length;i++){
      const t=i/sr,d=length/sr,edge=Math.min(1,t/.012,(d-t)/.035);
      const envelope=instrument==='piano'?Math.exp(-3*t):.85+.15*Math.exp(-5*t);
      out[a+i]+=.16*Math.max(0,edge)*envelope*(Math.sin(2*Math.PI*freq*t)+.15*Math.sin(4*Math.PI*freq*t)+.04*Math.sin(6*Math.PI*freq*t));
    }
  }
  return {sampleRate:sr,channels:[out]};
}
export function metronomePCM(project:Project,speed:number,sampleRate=22050):PCM {
  const out=new Float32Array(Math.ceil(projectDuration(project)/speed*sampleRate));
  if(project.score){
    const starts=new Set(project.score.route.map(m=>m.q));
    for(const q of beatGrid(project.score)) {
      if(q>=project.score.totalQ)continue;
      const a=Math.round(qToSeconds(q,project.scoreMap)/speed*sampleRate),f=starts.has(q)?1600:1100;
      for(let i=0;i<sampleRate*.045&&a+i<out.length;i++)if(a+i>=0)out[a+i]+=.22*Math.sin(2*Math.PI*f*i/sampleRate)*Math.exp(-i/sampleRate*90);
    }
  }
  return {sampleRate,channels:[out]};
}
