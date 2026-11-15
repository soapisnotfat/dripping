import {describe,it,expect} from 'vitest';
import {stretchAudio,encodeWav,renderTrack,splitClips,clearClips,trimClips} from '../src/lib/audio';
import type {Clip,PCM,Track} from '../src/lib/types';
const sr=12000;
const tone=(freq:number,seconds=2)=>Float32Array.from({length:Math.round(sr*seconds)},(_,i)=>Math.sin(2*Math.PI*freq*i/sr)*.2);
const signal:PCM={sampleRate:sr,channels:[tone(440),tone(660)]};
function frequency(signal:Float32Array){const crossings:number[]=[];const from=Math.floor(signal.length*.2),to=Math.floor(signal.length*.8);for(let i=from+1;i<to;i++)if(signal[i-1]<0&&signal[i]>=0)crossings.push(i-1-signal[i-1]/(signal[i]-signal[i-1]));return (crossings.length-1)*sr/(crossings.at(-1)!-crossings[0]);}
const clip:Clip={id:'c',assetId:'a',label:'audio',start:0,end:2,sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0};
const track:Track={id:'t',name:'Test',role:'backing',sourceAssetId:'a',clips:[clip],volume:.5,pan:0,mute:false,solo:false,offset:0,color:0};
describe('PCM and non-destructive edits',()=>{
  it('splits without changing source samples or the source clip',()=>{
    const divided=splitClips([clip],.5,1.5);expect(divided.map(c=>c.sourceStart)).toEqual([0,.5,1.5]);
    const out=renderTrack({...track,clips:divided},new Map([['a',signal]]),0,2,sr);
    expect(out.channels[0]).toEqual(signal.channels[0]);expect(clip.end).toBe(2);
  });
  it('clears a range without shifting later audio and trims non-destructively',()=>{
    const out=renderTrack({...track,clips:clearClips([clip],.5,1.5)},new Map([['a',signal]]),0,2,sr);
    expect(out.channels[0].slice(sr*.5,sr*1.5).every(v=>v===0)).toBe(true);
    expect(out.channels[1].slice(sr*1.5)).toEqual(signal.channels[1].slice(sr*1.5));
    expect(trimClips([clip],.5,1.5)[0]).toMatchObject({start:.5,end:1.5,sourceStart:.5});
  });
  it('exports float WAV with correct channels, rate and duration',()=>{
    const wav=encodeWav(signal,32),v=new DataView(wav);expect(v.getUint16(20,true)).toBe(3);expect(v.getUint16(22,true)).toBe(2);expect(v.getUint32(24,true)).toBe(sr);expect(wav.byteLength).toBe(44+sr*2*2*4);
  });
  it.each([-1,1])('preserves a stereo channel when panning it fully across the output (%s)',pan=>{
    const pcm:PCM={sampleRate:sr,channels:[new Float32Array(sr).fill(pan===1?.2:0),new Float32Array(sr).fill(pan===-1?.2:0)]};
    const out=renderTrack({...track,pan,volume:1,clips:[{...clip,end:1}]},new Map([['a',pcm]]),0,1,sr,1,true);
    expect(out.channels[pan===1?1:0][100]).toBeCloseTo(.2,6);
    expect(out.channels[pan===1?0:1][100]).toBeCloseTo(0,6);
  });
  it.each([.5,.75,1.25,1.5])('changes duration at %s× while retaining pitch and stereo separation',(speed)=>{
    const out=stretchAudio(signal,speed);expect(out.channels[0].length).toBe(Math.ceil(sr*2/speed));
    expect(frequency(out.channels[0])).toBeCloseTo(440,0);expect(frequency(out.channels[1])).toBeCloseTo(660,0);
    expect(out.channels[0].some(v=>Math.abs(v)>.1)).toBe(true);
  });
  it('handles short clips and an empty source without hanging',()=>{
    expect(stretchAudio({sampleRate:sr,channels:[tone(440,.01)]},.5).channels[0]).toHaveLength(240);
    expect(stretchAudio({sampleRate:sr,channels:[new Float32Array(0)]},.5).channels[0]).toHaveLength(0);
  });
});
