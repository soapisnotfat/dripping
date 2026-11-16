// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {conformAudio,conformKnots} from '../src/lib/alignment';
import {parseScore} from '../src/lib/score';
import {tempoMap,qToSeconds,secondsToQ,beatGrid} from '../src/lib/time';
import type {Anchor,Score} from '../src/lib/types';

function scoreFor(bars:{beats:number;unit:number;duration?:number;tempo?:{offset:number;bpm:number}[];repeat?:boolean}[]):Score{
  return parseScore(`<score-partwise><part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list><part id="P1">${bars.map((bar,index)=>`<measure number="${index+1}"${bar.duration?' implicit="yes"':''}><attributes><divisions>8</divisions><time><beats>${bar.beats}</beats><beat-type>${bar.unit}</beat-type></time></attributes>${index===0?'<direction><sound tempo="120"/></direction>':''}${(bar.tempo||[]).map(tempo=>`<direction><offset>${tempo.offset*8}</offset><sound tempo="${tempo.bpm}"/></direction>`).join('')}<note><rest/><duration>${(bar.duration||bar.beats*4/bar.unit)*8}</duration></note>${bar.repeat?'<barline><repeat direction="backward"/></barline>':''}</measure>`).join('')}</part></score-partwise>`);
}
const sr=12000;
function markers(score:Score,map:Anchor[],qs:number[]){const samples=new Float32Array(Math.ceil((qToSeconds(score.totalQ,map)+.4)*sr));for(const q of qs){const a=Math.round(qToSeconds(q,map)*sr);for(let i=0;i<.09*sr;i++)samples[a+i]=.4*Math.sin(2*Math.PI*880*i/sr);}return {sampleRate:sr,channels:[samples]};}
function onset(samples:Float32Array,expected:number):number{
  const a=Math.max(0,Math.round((expected-.2)*sr)),b=Math.min(samples.length,Math.round((expected+.2)*sr)),window=60;
  for(let i=a;i<b-window;i++){let power=0;for(let j=0;j<window;j++)power+=samples[i+j]**2;if(Math.sqrt(power/window)>.07)return i/sr;}
  throw Error(`No onset near ${expected}`);
}
function onsetErrors(score:Score,source:Anchor[],qs:number[],manual:number[]=[]){const target=tempoMap(score),duration=qToSeconds(score.totalQ,target),out=conformAudio(markers(score,source,qs),source,target,duration,score,manual);return qs.map(q=>{const actual=onset(out.channels[0],qToSeconds(q,target)),bar=[...score.route].reverse().find(bar=>bar.q<=q)!,beatQ=4/score.measures[bar.measure].beatType;return {q,actual,errorBeats:(secondsToQ(actual,target)-q)/beatQ};});}

// The .2-beat ceiling guards this tempo/meter regression. Current SoundTouch
// can still move transients inside a stretched segment; the separate quality
// target is <=1/16 beat and is not claimed by these regression checks.
it('renders an exact mid-bar tempo anchor at its musical onset',()=>{
  const score=scoreFor([{beats:4,unit:4,tempo:[{offset:2,bpm:60}]}]),source=[{q:0,seconds:0},{q:2,seconds:1},{q:4,seconds:2}],errors=onsetErrors(score,source,[1,2,3]);
  expect(conformKnots(score,source,tempoMap(score))).toContain(2);expect(Math.max(...errors.map(point=>Math.abs(point.errorBeats)))).toBeLessThan(.2);
});
it.each([
  ['3/4',scoreFor([{beats:3,unit:4},{beats:3,unit:4}]),[{q:0,seconds:.2},{q:1,seconds:.8},{q:3,seconds:2},{q:4,seconds:2.8},{q:6,seconds:3.8}],[1,3,4]],
  ['6/8',scoreFor([{beats:6,unit:8},{beats:6,unit:8}]),[{q:0,seconds:.15},{q:.5,seconds:.4},{q:1.5,seconds:.85},{q:3,seconds:1.6},{q:4.5,seconds:2.2},{q:6,seconds:2.95}],[.5,1.5,3,4.5]],
  ['pickup and changing meter',scoreFor([{beats:3,unit:4,duration:1},{beats:3,unit:4},{beats:6,unit:8},{beats:2,unit:4}]),[{q:0,seconds:.2},{q:1,seconds:.9},{q:4,seconds:2.4},{q:7,seconds:3.8},{q:9,seconds:5}],[1,2,4,5.5,7,8]],
  ['expanded repeat route',scoreFor([{beats:3,unit:4},{beats:3,unit:4,repeat:true}]),[{q:0,seconds:.2},{q:3,seconds:1.9},{q:6,seconds:3.2},{q:9,seconds:4.9},{q:12,seconds:6.2}],[1,3,6,9]],
] as const)('renders %s onsets in score beats',(_name,score,source,qs)=>{
  const errors=onsetErrors(score,[...source],[...qs]);expect(Math.max(...errors.map(point=>Math.abs(point.errorBeats)))).toBeLessThan(.2);
});
it('preserves an explicitly edited offbeat anchor while reducing dense automatic frame points',()=>{
  const score=scoreFor([{beats:4,unit:4}]),source=[{q:0,seconds:.2},{q:1.375,seconds:1.2},{q:4,seconds:2.5}],target=tempoMap(score),errors=onsetErrors(score,source,[1.375],[1.375]);
  expect(conformKnots(score,source,target,[1.375])).toContain(1.375);expect(Math.abs(errors[0].errorBeats)).toBeLessThan(.2);
  const dense=Array.from({length:251},(_,index)=>({q:index*4/250,seconds:.2+index*2/250+.006*Math.sin(index)})),knots=conformKnots(score,dense,target);expect(knots.length).toBeLessThan(beatGrid(score).length);
  const reduced=knots.map(q=>({q,seconds:qToSeconds(q,dense)}));for(const q of beatGrid(score))expect(Math.abs(secondsToQ(qToSeconds(q,dense),reduced)-q)).toBeLessThanOrEqual(1/16);
});
it('preserves stereo pitch, finite samples and smooth joins at musical warp boundaries',()=>{
  const score=scoreFor([{beats:3,unit:4},{beats:6,unit:8,tempo:[{offset:1.5,bpm:90}]}]),source=[{q:0,seconds:0},{q:1,seconds:.7},{q:3,seconds:1.9},{q:4.5,seconds:2.5},{q:6,seconds:3.4}],target=tempoMap(score),duration=qToSeconds(score.totalQ,target),input={sampleRate:sr,channels:[440,660].map(pitch=>Float32Array.from({length:Math.ceil(3.5*sr)},(_,i)=>.2*Math.sin(2*Math.PI*pitch*i/sr)))},out=conformAudio(input,source,target,duration,score);
  expect(out.channels.map(channel=>channel.length)).toEqual([Math.ceil(duration*sr),Math.ceil(duration*sr)]);
  for(const [channel,pitch] of [[0,440],[1,660]]){const data=out.channels[channel];expect(data.every(Number.isFinite)).toBe(true);for(const q of [.5,2,3.5,5]){const at=qToSeconds(q,target),a=Math.round(at*sr),b=a+Math.round(.12*sr),crossings:number[]=[];for(let i=a+1;i<b;i++)if(data[i-1]<0&&data[i]>=0)crossings.push(i);expect((crossings.length-1)*sr/(crossings.at(-1)!-crossings[0])).toBeCloseTo(pitch,-1);}for(const q of conformKnots(score,source,target).slice(1,-1)){const at=Math.round(qToSeconds(q,target)*sr);let jump=0;for(let i=Math.max(1,at-240);i<Math.min(data.length,at+240);i++)jump=Math.max(jump,Math.abs(data[i]-data[i-1]));expect(jump).toBeLessThan(.15);}}
});
