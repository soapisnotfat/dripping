class DrippingPCMRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.channels=options.processorOptions.channels || [0];
    this.capacity=4096;this.offset=0;this.sequence=0;this.active=false;this.finished=false;
    this.buffers=this.channels.map(()=>new Float32Array(this.capacity));
    this.meterPeaks=this.channels.map(()=>0);this.meterClipped=false;
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
    if(this.finished)return true;
    const input=inputs[0];if(!input?.length)return true;
    if(this.channels.some(c=>c>=input.length)){this.port.postMessage({type:'error',message:'所选输入通道不可用 / Selected input channel unavailable'});this.finish();return true;}
    const peaks=this.channels.map(channel=>{let peak=0;for(const value of input[channel])peak=Math.max(peak,Math.abs(value));return peak;});
    peaks.forEach((peak,index)=>{this.meterPeaks[index]=Math.max(this.meterPeaks[index],peak);if(peak>=.999)this.meterClipped=true;});
    if(currentFrame%(128*12)===0){this.port.postMessage({type:'meter',peak:Math.max(...this.meterPeaks),peaks:this.meterPeaks.slice(),clipped:this.meterClipped});this.meterPeaks.fill(0);this.meterClipped=false;}
    if(!this.active)return true;
    for(let i=0;i<input[0].length;i++){
      const frame=currentFrame+i;
      if(frame>=this.endFrame){this.finish();break;}
      if(frame<this.startFrame)continue;
      for(let c=0;c<this.channels.length;c++)this.buffers[c][this.offset]=input[this.channels[c]][i];
      if(++this.offset===this.capacity)this.flush();
    }
    return true;
  }
}
registerProcessor('dripping-pcm-recorder',DrippingPCMRecorder);
