import type {Project,PCM,Track} from './types';
import {copyBuffer,toAudioBuffer} from './audio';
import {getAsset} from './storage';
import {audioJobs} from './jobs';
import {projectDuration,qToSeconds,secondsToQ} from './time';
import {referencePCM,referencePreviewPCM,metronomePCM} from './reference';
import {audibleTrackIds} from './mix';

export class Transport {
  private context?:AudioContext;
  readonly pcm=new Map<string,PCM>();
  private rendered=new Map<string,{key:string;buffer:AudioBuffer}>();
  private nodes:AudioBufferSourceNode[]=[];
  private clicks:OscillatorNode[]=[];
  private gains=new Map<string,GainNode>();
  private pans=new Map<string,StereoPannerNode>();
  private destination?:GainNode;
  private startTime=0;
  private origin=0;
  private speed=1;
  private end=0;
  private loopRange?:{start:number;end:number};
  playing=false;
  reference=false;
  metronome=false;
  referenceInstrument:'flute'|'piano'='flute';
  referenceVolume=.65;
  get ctx(){if(!this.context){this.context=new AudioContext({latencyHint:'interactive'});this.destination=this.context.createGain();this.destination.connect(this.context.destination);}return this.context;}
  async asset(id:string):Promise<PCM>{
    if(this.pcm.has(id))return this.pcm.get(id)!;
    const asset=await getAsset(id),buffer=await this.ctx.decodeAudioData(await asset.blob.arrayBuffer());
    if(buffer.numberOfChannels>2)throw Error('请导入单声道或立体声音频 / Import mono or stereo audio');
    const pcm=copyBuffer(buffer);this.pcm.set(id,pcm);return pcm;
  }
  async decode(file:Blob):Promise<PCM>{return copyBuffer(await this.ctx.decodeAudioData(await file.arrayBuffer()));}
  async prepare(project:Project,onProgress?:(text:string)=>void){
    const duration=projectDuration(project),sr=this.ctx.sampleRate;
    for(const track of project.tracks){
      if(!track.clips.length){this.rendered.delete(track.id);continue;}
      const key=JSON.stringify([track.clips,track.offset,project.speed,duration]);
      if(this.rendered.get(track.id)?.key===key)continue;
      onProgress?.(track.name);
      const assetIds=[...new Set(track.clips.map(c=>c.assetId))];
      const buffers=await Promise.all(assetIds.map(async id=>[id,await this.asset(id)] as [string,PCM]));
      const pcm=await audioJobs.run<PCM>('render',{track,buffers,from:0,to:duration,sampleRate:sr,speed:project.speed,mixed:false});
      this.rendered.set(track.id,{key,buffer:toAudioBuffer(pcm,this.ctx)});
    }
    if(project.score){
      const key=JSON.stringify([project.scoreXml,project.score.partId,project.scoreMap,project.speed,this.referenceInstrument,duration]);
      if(this.rendered.get('reference')?.key!==key){
        const pcm=referencePCM(project,this.referenceInstrument);
        const rendered=project.speed===1?pcm:await audioJobs.run<PCM>('stretch',{pcm,speed:project.speed});
        this.rendered.set('reference',{key,buffer:toAudioBuffer(rendered,this.ctx)});
        this.rendered.set('metronome',{key,buffer:toAudioBuffer(metronomePCM(project,project.speed),this.ctx)});
      }
    }
  }
  async start(project:Project,from:number,onProgress?:(text:string)=>void,countIn=0,durationOverride?:number):Promise<number>{
    this.pause();await this.ctx.resume();await this.prepare(project,onProgress);
    this.origin=from;this.speed=project.speed;this.end=durationOverride??projectDuration(project);
    this.loopRange=project.loop&&project.selection?{start:project.selection.start,end:project.selection.end}:undefined;
    const q=secondsToQ(from,project.scoreMap),occurrence=project.score?[...project.score.route].reverse().find(m=>m.q<=q):undefined,beatQ=4/(occurrence?project.score!.measures[occurrence.measure].beatType:4);
    const beatSeconds=project.score?qToSeconds(q+beatQ,project.scoreMap)-qToSeconds(q,project.scoreMap):.625;
    const delay=countIn*beatSeconds/project.speed;
    this.startTime=this.ctx.currentTime+.18+delay;
    for(let i=0;i<countIn;i++)this.click(this.startTime-delay+i*beatSeconds/project.speed,i===0);
    const add=(id:string,track?:Track)=>{
      const rendered=this.rendered.get(id);if(!rendered)return;
      const node=this.ctx.createBufferSource(),gain=this.ctx.createGain(),pan=this.ctx.createStereoPanner();
      node.buffer=rendered.buffer;node.connect(gain).connect(pan).connect(this.destination!);
      if(this.loopRange){node.loop=true;node.loopStart=this.loopRange.start/project.speed;node.loopEnd=this.loopRange.end/project.speed;}
      this.gains.set(id,gain);this.pans.set(id,pan);this.nodes.push(node);
      if(from/project.speed<node.buffer.duration)node.start(this.startTime,Math.max(0,from/project.speed));
      if(track)pan.pan.value=track.pan;
    };
    project.tracks.forEach(t=>add(t.id,t));if(project.score){add('reference');add('metronome');}
    this.playing=true;this.updateMix(project);return this.startTime;
  }
  async previewInstrument(instrument:'flute'|'piano'){
    this.pause();await this.ctx.resume();
    const node=this.ctx.createBufferSource();node.buffer=toAudioBuffer(referencePreviewPCM(instrument),this.ctx);
    node.connect(this.ctx.destination);this.nodes.push(node);
    node.onended=()=>{node.disconnect();this.nodes=this.nodes.filter(n=>n!==node);};node.start();
  }
  private click(at:number,accent:boolean){
    const oscillator=this.ctx.createOscillator(),gain=this.ctx.createGain();oscillator.frequency.value=accent?1600:1100;
    gain.gain.setValueAtTime(.2,at);gain.gain.exponentialRampToValueAtTime(.001,at+.04);oscillator.connect(gain).connect(this.destination!);oscillator.start(at);oscillator.stop(at+.05);
    this.clicks.push(oscillator);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();this.clicks=this.clicks.filter(n=>n!==oscillator);};
  }
  updateMix(project:Project){
    const audible=new Set(audibleTrackIds(project.tracks));
    for(const track of project.tracks){this.gains.get(track.id)?.gain.setTargetAtTime(audible.has(track.id)?track.volume:0,this.ctx.currentTime,.012);this.pans.get(track.id)?.pan.setTargetAtTime(track.pan,this.ctx.currentTime,.012);}
    this.gains.get('reference')?.gain.setTargetAtTime(this.reference?this.referenceVolume:0,this.ctx.currentTime,.01);
    this.gains.get('metronome')?.gain.setTargetAtTime(this.metronome?.6:0,this.ctx.currentTime,.01);
  }
  position():number{
    if(!this.playing)return this.origin;
    const position=this.origin+Math.max(0,this.ctx.currentTime-this.startTime)*this.speed;
    if(this.loopRange&&position>=this.loopRange.end)return this.loopRange.start+(position-this.loopRange.end)%(this.loopRange.end-this.loopRange.start);
    return Math.min(position,this.end);
  }
  get finished(){return this.playing&&!this.loopRange&&this.position()>=this.end;}
  get countingIn(){return this.playing&&this.ctx.currentTime<this.startTime;}
  pause():number{
    const position=this.position();for(const n of [...this.nodes,...this.clicks]){try{n.stop();}catch{}n.disconnect();}this.nodes=[];this.clicks=[];this.gains.clear();this.pans.clear();this.playing=false;this.origin=position;return position;
  }
  seek(seconds:number){this.origin=seconds;}
  reset(){this.pause();this.pcm.clear();this.rendered.clear();this.origin=0;}
}
export const transport=new Transport();
