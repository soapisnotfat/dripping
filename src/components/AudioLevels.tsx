import {useEffect,useRef,useState} from 'react';
import type {Locale} from '../lib/types';
import {amplitudeDb} from '../lib/master';
import {transport} from '../lib/transport';

export function AudioLevels({locale,playing,recording,inputPeak,inputClipped,gainDb,onGain}:{locale:Locale;playing:boolean;recording:boolean;inputPeak:number;inputClipped:boolean;gainDb:number;onGain:(db:number)=>void}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en,[output,setOutput]=useState({peak:0,rms:0,hold:0}),hold=useRef(0);
  useEffect(()=>{
    if(!playing){setOutput(previous=>({...previous,peak:0,rms:0}));return;}
    hold.current=0;setOutput({peak:0,rms:0,hold:0});
    let frame=0,last=0;
    const update=(now:number)=>{if(now-last>45){last=now;const levels=transport.outputLevels();hold.current=Math.max(hold.current,levels.peak);setOutput({...levels,hold:hold.current});}frame=requestAnimationFrame(update);};frame=requestAnimationFrame(update);return()=>cancelAnimationFrame(frame);
  },[playing]);
  const db=(value:number)=>value>0?`${amplitudeDb(value).toFixed(1)} dBFS`:'−∞ dBFS';
  return <div className="audio-levels">
    <div className={`level-readout ${inputClipped?'near-peak':''}`}><span>{t('录音输入','Recording input')}</span><meter aria-label={t('录音输入峰值','Recording input peak')} min="0" max="1" value={inputPeak}/><output>{recording?db(inputPeak):'—'}</output>{inputClipped&&<strong role="status">{t('输入曾接近削波 · 降低设备输入增益','Input approached clipping · lower device input gain')}</strong>}</div>
    <div className={`level-readout ${output.hold>=1?'near-peak':''}`}><span>{t('主输出','Main output')}</span><meter aria-label={t('输出采样峰值','Output sample peak')} min="0" max="1" value={output.peak}/><output title={`${t('平均电平（RMS）','Average level (RMS)')}: ${db(output.rms)}`}>{db(output.peak)}</output><small>{t('峰值保持','Peak hold')} {db(output.hold)}{output.hold>=1?` · ${t('降低输出','Lower output')}`:''}</small></div>
    <label className="output-gain">{t('输出增益','Output gain')}<input aria-label={t('输出增益（dB）','Output gain (dB)')} type="range" min="-36" max="6" step=".5" value={gainDb} onChange={event=>onGain(Number(event.target.value))}/><output>{gainDb>0?'+':''}{gainDb.toFixed(1)} dB</output></label>
  </div>;
}
