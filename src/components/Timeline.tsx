import {useEffect,useRef,useState} from 'react';
import type {Project,Locale,Track,Selection,Clip} from '../lib/types';
import {formatTime,projectDuration,qToSeconds,nearestBeat} from '../lib/time';

export type Waveform={peaks:Float32Array;duration:number};
const LABEL=190;
type Props={project:Project;position:number;locale:Locale;scale:number;snap:boolean;follow:boolean;waveforms:Map<string,Waveform>;recording:boolean;
  onSeek:(seconds:number)=>void;onSelect:(selection:Selection|null)=>void;onTrack:(trackId:string,patch:Partial<Track>)=>void;
  onContext:(x:number,y:number)=>void;onFollow:(value:boolean)=>void;onTrackSettings:(id:string)=>void};

function Wave({clip,wave,color,width}:{clip:Clip;wave?:Waveform;color:number;width:number}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!canvas.current||!wave)return;
    const ctx=canvas.current.getContext('2d');if(!ctx)return;
    const pixels=Math.min(6000,Math.max(1,Math.ceil(width))),height=48;
    canvas.current.width=pixels;canvas.current.height=height;ctx.clearRect(0,0,pixels,height);
    ctx.fillStyle=['#9d824d','#668d88','#a26d73','#7c83a7'][color%4];
    const sourceEnd=clip.sourceStart+(clip.end-clip.start)*clip.rate;
    for(let x=0;x<pixels;x+=2){
      const a=Math.floor((clip.sourceStart+x/pixels*(sourceEnd-clip.sourceStart))/wave.duration*wave.peaks.length);
      const b=Math.max(a+1,Math.floor((clip.sourceStart+(x+2)/pixels*(sourceEnd-clip.sourceStart))/wave.duration*wave.peaks.length));
      let p=0;for(let i=a;i<b;i++)p=Math.max(p,wave.peaks[i]||0);
      const h=Math.max(1,Math.min(42,p*60));ctx.fillRect(x,(height-h)/2,1.4,h);
    }
  },[wave,clip,width,color]);
  return <canvas ref={canvas} className="wave-canvas" aria-hidden="true"/>;
}
export function Timeline({project,position,locale,scale,snap,follow,waveforms,recording,onSeek,onSelect,onTrack,onContext,onFollow,onTrackSettings}:Props){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en,scroller=useRef<HTMLDivElement>(null),drag=useRef<{start:number;trackId:string;downX:number;moved:boolean}|null>(null);
  const [hover,setHover]=useState<number|null>(null),duration=projectDuration(project),width=Math.max(640,duration*scale+40);
  useEffect(()=>{const el=scroller.current;if(!el||!follow)return;const x=position*scale+LABEL;if(x>el.scrollLeft+el.clientWidth-90||x<el.scrollLeft+LABEL){el.scrollLeft=Math.max(0,x-LABEL-el.clientWidth*.22);}},[position,scale,follow]);
  const point=(e:React.PointerEvent<HTMLElement>|React.MouseEvent<HTMLElement>,lane:HTMLElement)=>{
    const raw=Math.max(0,Math.min(duration,(e.clientX-lane.getBoundingClientRect().left)/scale));return snap&&!e.altKey?nearestBeat(raw,project):raw;
  };
  const labels=project.score?project.score.route.map(m=>({seconds:qToSeconds(m.q,project.scoreMap),label:m.number,small:m.pass>1?`·${m.pass}`:''})):Array.from({length:Math.ceil(duration/5)},(_,i)=>({seconds:i*5,label:formatTime(i*5),small:''}));
  return <div ref={scroller} className="timeline-scroll" onWheel={()=>onFollow(false)}>
    <div className="timeline-content" style={{width:LABEL+width}}>
      <div className="ruler-row"><div className="track-label ruler-label">{t('小节 · 音轨','Bars · Tracks')}</div><div className="ruler" style={{width}} onPointerDown={e=>onSeek(point(e,e.currentTarget))}>
        {labels.filter((l,i)=>i===0||l.seconds*scale-labels[i-1].seconds*scale>22||i%2===0).map((l,i)=><span key={i} style={{left:l.seconds*scale}}>{l.label}<small>{l.small}</small></span>)}
      </div></div>
      {project.tracks.map(track=><div className={`track-row color-${track.color%4}`} key={track.id}>
        <div className="track-label"><div className="track-name"><button className="text-button" onClick={()=>onTrackSettings(track.id)} title={t('音轨设置','Track settings')}>{track.name}</button><span className="role-label">{track.role==='backing'?t('伴奏','Backing'):track.role==='demo'?t('示范','Demo'):'REC'}</span></div>
          <div className="track-controls"><button className={track.mute?'active':''} aria-label={`${t('静音','Mute')} ${track.name}`} aria-pressed={track.mute} onClick={()=>onTrack(track.id,{mute:!track.mute})}>M</button><button className={track.solo?'active':''} aria-label={`${t('独奏','Solo')} ${track.name}`} aria-pressed={track.solo} onClick={()=>onTrack(track.id,{solo:!track.solo})}>S</button><input aria-label={`${track.name} ${t('音量','volume')}`} type="range" min="0" max="1.5" step=".01" value={track.volume} onChange={e=>onTrack(track.id,{volume:Number(e.target.value)})}/></div>
        </div>
        <div className={`track-lane ${track.mute?'is-muted':''}`} style={{width}} tabIndex={0} aria-label={`${track.name} ${t('时间轴','timeline')}`}
          onPointerDown={e=>{if(recording||e.button!==0)return;const start=point(e,e.currentTarget);drag.current={start,trackId:track.id,downX:e.clientX,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerMove={e=>{const end=point(e,e.currentTarget);setHover(end);const d=drag.current;if(!d||Math.abs(e.clientX-d.downX)<4)return;d.moved=true;onSelect({start:Math.min(d.start,end),end:Math.max(d.start,end),trackId:track.id});}}
          onPointerUp={e=>{const d=drag.current;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(!d?.moved&&d)onSeek(d.start);}}
          onPointerCancel={()=>drag.current=null}
          onPointerLeave={()=>setHover(null)}
          onContextMenu={e=>{e.preventDefault();if(recording)return;const p=point(e,e.currentTarget);if(!project.selection||p<project.selection.start||p>project.selection.end)onSelect({start:p,end:Math.min(duration,p+.5),trackId:track.id});else onSelect({...project.selection,trackId:track.id});onContext(e.clientX,e.clientY);}}
          onKeyDown={e=>{if(e.shiftKey&&e.key==='F10'){e.preventDefault();if(!project.selection)onSelect({start:position,end:Math.min(duration,position+1),trackId:track.id});const r=e.currentTarget.getBoundingClientRect();onContext(r.left+40,r.top+20);}if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();onSeek(Math.max(0,Math.min(duration,position+(e.key==='ArrowRight'?1:-1)*.25)));}}}>
          {track.clips.map(clip=><div className="audio-clip" key={clip.id} style={{left:(clip.start+track.offset)*scale,width:(clip.end-clip.start)*scale}} title={`${clip.label} · ${formatTime(clip.end-clip.start,true)}`}><span>{clip.label}</span><Wave clip={clip} wave={waveforms.get(clip.assetId)} color={track.color} width={(clip.end-clip.start)*scale}/>{clip.fadeIn>0&&<i className="fade-in" style={{width:clip.fadeIn*scale}}/>}{clip.fadeOut>0&&<i className="fade-out" style={{width:clip.fadeOut*scale}}/>}</div>)}
          {recording&&track.role==='recording'&&<div className="recording-region" style={{left:(project.selection?.start||0)*scale,width:Math.max(2,(position-(project.selection?.start||0))*scale)}}><span>{t('正在录音','Recording')}</span></div>}
          {project.selection&&(!project.selection.trackId||project.selection.trackId===track.id)&&<div className="lane-selection" style={{left:project.selection.start*scale,width:(project.selection.end-project.selection.start)*scale}}/>}
        </div>
      </div>)}
      {!project.tracks.length&&<div className="timeline-empty">{t('添加伴奏或示范音频，或者直接录一段。','Add backing or demonstration audio, or record a take.')}</div>}
      <div className="timeline-playhead" style={{left:LABEL+position*scale}}><span/></div>
      {hover!==null&&<div className="timeline-hover" style={{left:LABEL+hover*scale}}/>}
    </div>
  </div>;
}
