import {Stretch} from '@soundtouchjs/core';
import type {PCM, Clip, Track} from './types';
import {clamp} from './types';

export function encodeWav(pcm:PCM, bitDepth:16|24|32=16,gain=1):ArrayBuffer {
  // Float preserves sources; integer PCM is used for finished listening files.
  const depth=bitDepth, bytes=depth/8, channels=pcm.channels.length, frames=pcm.channels[0]?.length || 0;
  if(!channels||channels>8||pcm.channels.some(c=>c.length!==frames))throw Error('Invalid PCM channels');
  const dataBytes=frames*channels*bytes;
  if(dataBytes>0xffffffff-44)throw Error('WAV exceeds RIFF size limit');
  const out=new ArrayBuffer(44+dataBytes),view=new DataView(out);
  const ascii=(at:number,text:string)=>[...text].forEach((v,i)=>view.setUint8(at+i,v.charCodeAt(0)));
  ascii(0,'RIFF');view.setUint32(4,36+dataBytes,true);ascii(8,'WAVE');ascii(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,depth===32?3:1,true);view.setUint16(22,channels,true);
  view.setUint32(24,pcm.sampleRate,true);view.setUint32(28,pcm.sampleRate*channels*bytes,true);
  view.setUint16(32,channels*bytes,true);view.setUint16(34,depth,true);ascii(36,'data');view.setUint32(40,dataBytes,true);
  for(let i=0;i<frames;i++)for(let c=0;c<channels;c++) {
    const raw=pcm.channels[c][i]*gain,value=Number.isFinite(raw)?raw:0,position=44+(i*channels+c)*bytes;
    if(depth===32)view.setFloat32(position,value,true);
    else if(depth===24){const s=clamp(value,-1,1),n=Math.round(s*(s<0?8388608:8388607));view.setUint8(position,n&255);view.setUint8(position+1,(n>>8)&255);view.setUint8(position+2,(n>>16)&255);}
    else {const s=clamp(value,-1,1);view.setInt16(position,Math.round(s*(s<0?32768:32767)),true);}
  }
  return out;
}

export function copyBuffer(buffer:AudioBuffer):PCM {
  return {sampleRate:buffer.sampleRate,channels:Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice())};
}
export function toAudioBuffer(pcm:PCM,ctx:BaseAudioContext):AudioBuffer {
  const buffer=ctx.createBuffer(pcm.channels.length,pcm.channels[0].length,pcm.sampleRate);
  pcm.channels.forEach((c,i)=>buffer.copyToChannel(c as Float32Array<ArrayBuffer>,i));return buffer;
}
export function resamplePCM(pcm:PCM,sampleRate:number,frames=Math.round(pcm.channels[0].length/pcm.sampleRate*sampleRate)):PCM{
  if(pcm.sampleRate===sampleRate&&pcm.channels[0].length===frames)return pcm;
  if(!Number.isInteger(sampleRate)||!Number.isInteger(pcm.sampleRate)||sampleRate<3000||pcm.sampleRate<3000||!Number.isInteger(frames)||frames<1||frames*pcm.channels.length>150_000_000)throw Error('Invalid resampling size or rate');
  // Exact rational phases, windowed-sinc low-pass filtering and zero padding.
  // The 128-tap base kernel grows for downsampling to reject aliased content.
  const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a,divisor=gcd(pcm.sampleRate,sampleRate),phases=sampleRate/divisor,step=pcm.sampleRate/divisor;
  const ratio=Math.min(1,sampleRate/pcm.sampleRate),cutoff=.96*ratio,half=Math.ceil(64/ratio),taps=2*half;
  const kernels=Array.from({length:phases},(_,phase)=>{
    const weights=new Float64Array(taps);let sum=0;
    for(let tap=0;tap<taps;tap++){
      const distance=phase/phases-(tap-half+1),angle=Math.PI*distance/half,window=.42+.5*Math.cos(angle)+.08*Math.cos(2*angle);
      const value=(Math.abs(distance)<1e-12?cutoff:Math.sin(Math.PI*cutoff*distance)/(Math.PI*distance))*window;weights[tap]=value;sum+=value;
    }
    for(let tap=0;tap<taps;tap++)weights[tap]/=sum;return weights;
  });
  return {sampleRate,channels:pcm.channels.map(source=>{
    const out=new Float32Array(frames);
    for(let i=0;i<frames;i++){const position=i*step,base=Math.floor(position/phases)-half+1,weights=kernels[position%phases];let value=0;for(let tap=0;tap<taps;tap++){const at=base+tap;if(at>=0&&at<source.length)value+=source[at]*weights[tap];}out[i]=value;}
    return out;
  })};
}
export function mono(pcm:PCM,targetRate=11025):Float32Array {
  const length=Math.ceil(pcm.channels[0].length*targetRate/pcm.sampleRate),out=new Float32Array(length);
  const ratio=pcm.sampleRate/targetRate;
  for(let i=0;i<length;i++) {
    const from=Math.floor(i*ratio),to=Math.min(pcm.channels[0].length,Math.max(from+1,Math.floor((i+1)*ratio)));
    let sum=0;for(const ch of pcm.channels)for(let j=from;j<to;j++)sum+=ch[j];
    out[i]=sum/((to-from)*pcm.channels.length || 1);
  }
  return out;
}
export function peaks(pcm:PCM,count=1200):Float32Array {
  const frames=pcm.channels[0].length,stride=Math.max(1,Math.ceil(frames/count)),out=new Float32Array(Math.ceil(frames/stride));
  for(let i=0;i<out.length;i++)for(const ch of pcm.channels)for(let n=i*stride;n<Math.min(frames,(i+1)*stride);n++)out[i]=Math.max(out[i],Math.abs(ch[n]));
  return out;
}

export function stretchAudio(pcm:PCM,speed:number):PCM {
  if(!Number.isFinite(speed)||speed<.25||speed>4)throw Error('Unsupported stretch ratio');
  if(pcm.channels.length>2)throw Error('Time stretching supports mono/stereo audio');
  if(Math.abs(speed-1)<1e-5)return {sampleRate:pcm.sampleRate,channels:pcm.channels.map(c=>c.slice())};
  if(!('resize' in ArrayBuffer.prototype))throw Error('保调变速需要较新的浏览器 / Update the browser to use pitch-preserving speed');
  const frames=pcm.channels[0].length,target=Math.ceil(frames/speed);
  if(!frames)return {sampleRate:pcm.sampleRate,channels:pcm.channels.map(()=>new Float32Array(0))};
  const result=pcm.channels.map(()=>new Float32Array(target));
  const stretch=new Stretch({sampleRate:pcm.sampleRate,createBuffers:true});stretch.tempo=speed;
  const input=stretch.inputBuffer!,output=stretch.outputBuffer!,block=4096;
  const interleaved=new Float32Array(block*2),drained=new Float32Array(block*2);
  let written=0;
  const drain=()=>{
    while(output.frameCount>0){
      const count=Math.min(block,output.frameCount);output.extract(drained,0,count);output.receive(count);
      const keep=Math.min(count,target-written);
      for(let i=0;i<keep;i++){result[0][written+i]=drained[2*i];if(result[1])result[1][written+i]=drained[2*i+1];}
      written+=keep;
    }
  };
  for(let pos=0;pos<frames;pos+=block){
    const count=Math.min(block,frames-pos);
    for(let i=0;i<count;i++){interleaved[2*i]=pcm.channels[0][pos+i];interleaved[2*i+1]=(pcm.channels[1]||pcm.channels[0])[pos+i];}
    input.putSamples(interleaved,0,count);stretch.process();drain();
  }
  interleaved.fill(0);
  const paddingLimit=4*(stretch.inputChunkSize+stretch.overlapLength+block);
  for(let padded=0;written<target&&padded<paddingLimit;padded+=block){input.putSamples(interleaved,0,block);stretch.process();drain();}
  if(written!==target)throw Error('Incomplete stretched audio');
  return {sampleRate:pcm.sampleRate,channels:result};
}

export function splitClips(clips:Clip[],a:number,b:number):Clip[] {
  let out=clips.map(c=>({...c}));
  for(const point of [a,b])out=out.flatMap(c=>point>c.start+1e-7&&point<c.end-1e-7?
    [{...c,id:c.id+'a',end:point,fadeOut:0},{...c,id:c.id+'b',start:point,sourceStart:c.sourceStart+(point-c.start)*c.rate,fadeIn:0}]:[c]);
  return out;
}
export function clearClips(clips:Clip[],a:number,b:number):Clip[]{return splitClips(clips,a,b).filter(c=>c.end<=a+1e-7||c.start>=b-1e-7);}
export function trimClips(clips:Clip[],a:number,b:number):Clip[]{return splitClips(clips,a,b).filter(c=>c.start>=a-1e-7&&c.end<=b+1e-7);}
export function slicePCM(pcm:PCM,start:number,end:number):PCM {
  const a=Math.max(0,Math.round(start*pcm.sampleRate)),b=Math.min(pcm.channels[0].length,Math.round(end*pcm.sampleRate));
  return {sampleRate:pcm.sampleRate,channels:pcm.channels.map(c=>c.slice(a,Math.max(a,b)))};
}

export function renderTrack(track:Track,buffers:Map<string,PCM>,from:number,to:number,sampleRate:number,speed=1,mixed=false):PCM {
  const channels=mixed?2:Math.max(1,...track.clips.map(c=>buffers.get(c.assetId)?.channels.length || 1));
  const length=Math.max(1,Math.round((to-from)/speed*sampleRate));
  if(length*channels>150_000_000)throw Error('导出范围过大，请分段导出 / Export a shorter range');
  const out=Array.from({length:channels},()=>new Float32Array(length));
  for(const clip of track.clips) {
    const raw=buffers.get(clip.assetId);if(!raw)throw Error('Missing audio asset');
    const start=clip.start+track.offset,end=clip.end+track.offset,a=Math.max(from,start),b=Math.min(to,end);
    if(b<=a)continue;
    const rawStart=clip.sourceStart+(a-start)*clip.rate,rawEnd=clip.sourceStart+(b-start)*clip.rate;
    const segment=stretchAudio(slicePCM(raw,rawStart,rawEnd),clip.rate*speed);
    const dest=Math.round((a-from)/speed*sampleRate),count=Math.min(length-dest,Math.round((b-a)/speed*sampleRate));
    for(let c=0;c<channels;c++) {
      const source=segment.channels[Math.min(c,segment.channels.length-1)];
      const mixGain=mixed?track.volume:1,pan=clamp(track.pan,-1,1);
      const angle=(pan<=0?pan+1:pan)*Math.PI/2;
      for(let i=0;i<count;i++) {
        const position=i*segment.sampleRate/sampleRate,j=Math.floor(position),f=position-j;
        let value=(source[j]||0)*(1-f)+(source[j+1]||0)*f;
        if(mixed){
          if(segment.channels.length===1)value*=c===0?Math.cos((pan+1)*Math.PI/4):Math.sin((pan+1)*Math.PI/4);
          else {
            // Match the StereoPannerNode used during playback, including crossfeed.
            const other=segment.channels[1-c],v=(other[j]||0)*(1-f)+(other[j+1]||0)*f;
            if(pan<=0)value=c===0?value+v*Math.cos(angle):value*Math.sin(angle);
            else value=c===0?value*Math.cos(angle):value+v*Math.sin(angle);
          }
        }
        const projectTime=a+i/sampleRate*speed;
        const fadeIn=clip.fadeIn?clamp((projectTime-start)/clip.fadeIn,0,1):1;
        const fadeOut=clip.fadeOut?clamp((end-projectTime)/clip.fadeOut,0,1):1;
        out[c][dest+i]+=value*clip.gain*mixGain*Math.min(fadeIn,fadeOut);
      }
    }
  }
  return {channels:out,sampleRate};
}

export function mixTracks(tracks:PCM[]):PCM {
  if(!tracks.length)throw Error('No tracks to mix');
  const sampleRate=tracks[0].sampleRate,frames=Math.max(...tracks.map(t=>t.channels[0].length));
  const channels=[new Float32Array(frames),new Float32Array(frames)];
  for(const track of tracks)for(let c=0;c<2;c++){const src=track.channels[Math.min(c,track.channels.length-1)];for(let i=0;i<src.length;i++)channels[c][i]+=src[i];}
  return {sampleRate,channels};
}
