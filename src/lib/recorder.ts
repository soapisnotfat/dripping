import recorderURL from '../workers/recorder.worklet.js?url';
import type {RecordingSession} from './types';
import {createSession,saveChunk} from './storage';

export class PCMRecorder {
  private stream?:MediaStream;
  private source?:MediaStreamAudioSourceNode;
  private node?:AudioWorkletNode;
  private monitor?:GainNode;
  private queue=Promise.resolve();
  private doneResolve?:()=>void;
  private doneReject?:(error:Error)=>void;
  private done?:Promise<void>;
  private session?:RecordingSession;
  private failed=false;
  private started=false;
  onMeter:(peak:number)=>void=()=>{};
  onError:(message:string)=>void=()=>{};
  onEnded:()=>void=()=>{};
  constructor(readonly ctx:AudioContext){}
  async open(deviceId:string,channels:number[],streamOverride?:MediaStream){
    if(!isSecureContext)throw Error('录音需要 HTTPS 或 localhost / Recording requires HTTPS or localhost');
    this.stream=streamOverride || await navigator.mediaDevices.getUserMedia({audio:{deviceId:deviceId?{exact:deviceId}:undefined,echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:{ideal:Math.max(...channels)+1}},video:false});
    await this.ctx.audioWorklet.addModule(recorderURL);
    this.source=this.ctx.createMediaStreamSource(this.stream);
    this.node=new AudioWorkletNode(this.ctx,'dripping-pcm-recorder',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:{channels}});
    this.source.connect(this.node);this.node.connect(this.ctx.destination);
    this.monitor=this.ctx.createGain();this.monitor.gain.value=0;this.source.connect(this.monitor).connect(this.ctx.destination);
    this.node.port.onmessage=({data})=>{
      if(data.type==='chunk'&&this.session){
        this.queue=this.queue.then(()=>saveChunk(this.session!.id,data.sequence,data.data)).catch(error=>{this.fail(error);});
      }else if(data.type==='meter')this.onMeter(data.peak);
      else if(data.type==='error')this.fail(Error(data.message));
      else if(data.type==='done'){
        this.queue.then(()=>{if(this.failed)return;this.close();this.doneResolve?.();this.onEnded();});
      }
    };
    this.node.onprocessorerror=()=>this.fail(Error('录音处理器中断，已写入的录音块可恢复 / Recorder interrupted; committed chunks can be recovered'));
    for(const track of this.stream.getTracks())track.onended=()=>{if(this.started)this.stop().catch(()=>{});};
    return this.stream.getAudioTracks()[0];
  }
  setMonitoring(enabled:boolean){this.monitor?.gain.setTargetAtTime(enabled?.6:0,this.ctx.currentTime,.02);}
  async arm(session:RecordingSession,startContextTime:number,endContextTime=Infinity){
    if(!this.node)throw Error('Input is not ready');
    this.session=session;await createSession(session);this.started=true;
    this.done=new Promise<void>((resolve,reject)=>{this.doneResolve=resolve;this.doneReject=reject;});
    // Register a handler immediately; UI may await stop much later.
    this.done.catch(()=>{});
    this.node.port.postMessage({type:'arm',startFrame:Math.ceil(startContextTime*this.ctx.sampleRate),endFrame:Number.isFinite(endContextTime)?Math.ceil(endContextTime*this.ctx.sampleRate):Infinity});
  }
  async stop(){
    if(!this.started){this.close();return;}
    this.node?.port.postMessage({type:'stop'});await this.done;
  }
  private fail(error:Error){if(this.failed)return;this.failed=true;this.onError(error.message);this.doneReject?.(error);this.close();}
  close(){this.started=false;this.source?.disconnect();this.node?.disconnect();this.monitor?.disconnect();this.stream?.getTracks().forEach(t=>{t.onended=null;t.stop();});}
}
