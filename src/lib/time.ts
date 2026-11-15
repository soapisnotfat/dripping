import type {Anchor, Score, Project} from './types';
import {clamp} from './types';

export function validateAnchors(anchors: Anchor[]): Anchor[] {
  if (anchors.length<2) throw Error('至少需要两个对齐点 / At least two anchors are required');
  for (let i=0;i<anchors.length;i++) {
    const a=anchors[i], p=anchors[i-1];
    if (!Number.isFinite(a.q)||!Number.isFinite(a.seconds)||(p&&(a.q<=p.q||a.seconds<=p.seconds))) throw Error('对齐点必须按时间递增 / Anchors must increase in both timelines');
  }
  return anchors;
}
function mapValue(value:number, anchors:Anchor[], from:'q'|'seconds', to:'q'|'seconds'):number {
  if (anchors.length<2) return value;
  let low=0,high=anchors.length-1;
  while(high-low>1){const m=(low+high)>>1;if(anchors[m][from]<=value)low=m;else high=m;}
  if(value<anchors[0][from]){low=0;high=1;}
  const a=anchors[low],b=anchors[high];
  return a[to]+(value-a[from])/(b[from]-a[from])*(b[to]-a[to]);
}
export const qToSeconds=(q:number, anchors:Anchor[])=>mapValue(q,anchors,'q','seconds');
export const secondsToQ=(seconds:number, anchors:Anchor[])=>mapValue(seconds,anchors,'seconds','q');
export function tempoMap(score: Score): Anchor[] {
  const changes=[...score.tempo].sort((a,b)=>a.q-b.q);
  let lastQ=0,seconds=0,bpm=changes[0]?.q===0?changes[0].bpm:80;
  const anchors:Anchor[]=[{q:0,seconds:0}];
  for(const c of changes){
    if(c.q>lastQ){seconds+=(c.q-lastQ)*60/bpm;anchors.push({q:c.q,seconds});lastQ=c.q;}
    bpm=c.bpm;
  }
  if(score.totalQ>lastQ)anchors.push({q:score.totalQ,seconds:seconds+(score.totalQ-lastQ)*60/bpm});
  return anchors;
}
export function beatGrid(score:Score): number[] {
  const result:number[]=[];
  for(const occurrence of score.route){
    const meter=score.measures[occurrence.measure];
    for(let local=0;local<occurrence.duration-1e-7;local+=4/meter.beatType) result.push(occurrence.q+local);
  }
  result.push(score.totalQ);return result;
}
export function nearestBeat(seconds:number, project:Project):number {
  if(!project.score)return Math.max(0,Math.round(seconds*10)/10);
  const q=secondsToQ(seconds,project.scoreMap),grid=beatGrid(project.score);
  const closest=grid.reduce((a,b)=>Math.abs(a-q)<Math.abs(b-q)?a:b);
  return Math.max(0,qToSeconds(closest,project.scoreMap));
}
export function positionLabel(seconds:number, project:Project):string {
  if(!project.score)return formatTime(seconds);
  const q=secondsToQ(seconds,project.scoreMap);
  if(q<0)return '—';
  const occurrence=[...project.score.route].reverse().find(m=>m.q<=q) || project.score.route[0];
  const meter=project.score.measures[occurrence.measure];
  return `${occurrence.number}.${Math.floor(clamp(q-occurrence.q,0,occurrence.duration-1e-6)/(4/meter.beatType))+1}`;
}
export function scorePositionLabel(q:number,score:Score,locale:'zh'|'en'='en'):string{
  if(!Number.isFinite(q)||q<0||!score.route.length)return '—';
  if(q>=score.totalQ-1e-7)return locale==='zh'?'结束':'End';
  const occurrence=[...score.route].reverse().find(m=>m.q<=q+1e-7)||score.route[0];
  const measure=score.measures[occurrence.measure],beat=(q-occurrence.q)/(4/measure.beatType);
  const whole=Math.floor(beat+1e-7),fraction=Number((beat-whole).toFixed(3));
  return `${occurrence.number}.${whole+1}${fraction>0?`+${fraction}`:''}${occurrence.pass>1?(locale==='zh'?`（第 ${occurrence.pass} 遍）`:` (pass ${occurrence.pass})`):''}`;
}
export function projectDuration(p:Project):number {
  return Math.max(1,p.score?qToSeconds(p.score.totalQ,p.scoreMap):0,...p.tracks.flatMap(t=>t.clips.map(c=>c.end+t.offset)));
}
export function formatTime(seconds:number, precision=false):string {
  const n=Math.max(0,seconds);return `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}${precision?'.'+Math.floor(n%1*1000).toString().padStart(3,'0'):''}`;
}
