class DrippingPCMRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels=options.processorOptions.channels || [0];
    this.capacity=4096;this.offset=0;this.sequence=0;this.active=false;this.finished=false;
    this.buffers=this.channels.map(()=>new Float32Array(this.capacity));
    this.port.onmessage=({data})=>{
      if(data.type==='arm'){this.startFrame=data.startFrame;this.endFrame=data.endFrame;this.active=true;}
      if(data.type==='stop'){this.endFrame=Math.min(this.endFrame??Infinity,currentFrame);this.finish();}
    };
  }
  flush(){
    if(!this.offset)return;
    const data=this.buffers.map(b=>b.slice(0,this.offset));
    this.port.postMessage({type:'chunk',sequence:this.sequence++,data},data.map(c=>c.buffer));this.offset=0;
  }
  finish(){if(this.finished)return;this.flush();this.active=false;this.finished=true;this.port.postMessage({type:'done'});}
  process(inputs,outputs){
    // Outputs deliberately remain zero: input is never mixed with the backing bus.
    for(const output of outputs)for(const channel of output)channel.fill(0);
    if(!this.active)return true;
    const input=inputs[0];if(!input?.length)return true;
    if(this.channels.some(c=>c>=input.length)){this.port.postMessage({type:'error',message:'所选输入通道不可用 / Selected input channel unavailable'});this.finish();return true;}
    let peak=0;
    for(let i=0;i<input[0].length;i++){
      const frame=currentFrame+i;
      if(frame>=this.endFrame){this.finish();break;}
      if(frame<this.startFrame)continue;
      for(let c=0;c<this.channels.length;c++){const value=input[this.channels[c]][i];this.buffers[c][this.offset]=value;peak=Math.max(peak,Math.abs(value));}
      if(++this.offset===this.capacity)this.flush();
    }
    if(peak>0&&currentFrame%(128*12)===0)this.port.postMessage({type:'meter',peak});
    return true;
  }
}
registerProcessor('dripping-pcm-recorder',DrippingPCMRecorder);
