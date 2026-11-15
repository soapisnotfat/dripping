import {useEffect,useRef,useState} from 'react';
import type {Project,Locale,Track,Selection,Clip,RecordingSession} from '../lib/types';
import {formatTime,projectDuration,qToSeconds,nearestBeat} from '../lib/time';
import {clipSelection,timelineFollowLeft} from '../lib/timeline';
import {clamp} from '../lib/types';

export type Waveform={peaks:Float32Array;duration:number};
const LABEL=190;
type Props={project:Project;position:number;locale:Locale;scale:number;snap:boolean;follow:boolean;waveforms:Map<string,Waveform>;recording:boolean;playing:boolean;counting:boolean;locked:boolean;armedTrackId?:string;activeRecording:Pick<RecordingSession,'trackId'|'start'>|null;onArm:(id:string)=>void;
  onSeek:(seconds:number)=>void;onSelect:(selection:Selection|null)=>void;onTrack:(trackId:string,patch:Partial<Track>)=>void;
  onContext:(x:number,y:number)=>void;onFollow:(value:boolean)=>void;onTrackSettings:(id:string)=>void};

function Wave({clip,wave,color,width}:{clip:Clip;wave?:Waveform;color:number;width:number}){
  const canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!canvas.current||!wave)return;
    const ctx=canvas.current.getContext('2d');if(!ctx)return;
    const pixels=Math.min(6000,Math.max(1,Math.ceil(width))),height=64;
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
export function Timeline({project,position,locale,scale,snap,follow,waveforms,recording,playing,counting,locked,armedTrackId,activeRecording,onArm,onSeek,onSelect,onTrack,onContext,onFollow,onTrackSettings}:Props){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en,scroller=useRef<HTMLDivElement>(null),drag=useRef<{start:number;section:Selection|null;downX:number;moved:boolean}|null>(null);
  const [hover,setHover]=useState<number|null>(null),[viewportWidth,setViewportWidth]=useState(0),followLeft=useRef<number|null>(null);
  const duration=Math.max(projectDuration(project),recording?position+5:0),width=Math.max(640,duration*scale+40);
  useEffect(()=>{
    const el=scroller.current;if(!el)return;
    const resize=new ResizeObserver(entries=>setViewportWidth(entries[0].contentRect.width));resize.observe(el);return()=>resize.disconnect();
  },[]);
  useEffect(()=>{
    const el=scroller.current;if(!el||!follow){followLeft.current=null;return;}
    const current=followLeft.current??el.scrollLeft,target=timelineFollowLeft(position*scale,current,el.clientWidth,LABEL+width,LABEL);
    if(target!==current||(!playing&&Math.abs(el.scrollLeft-target)>.5)){
      followLeft.current=target;
      const smooth=playing&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches&&Math.abs(target-el.scrollLeft)<el.clientWidth;
      el.scrollTo({left:target,behavior:smooth?'smooth':'instant'});
    }
  },[position,scale,follow,viewportWidth,playing,width]);
  useEffect(()=>{
    const el=scroller.current;if(!el||!armedTrackId)return;
    const row=[...el.querySelectorAll<HTMLElement>('.track-row')].find(row=>row.dataset.trackId===armedTrackId);if(!row)return;
    if(row.offsetTop<el.scrollTop+30)el.scrollTop=Math.max(0,row.offsetTop-30);
    else if(row.offsetTop+row.offsetHeight>el.scrollTop+el.clientHeight)el.scrollTop=row.offsetTop+row.offsetHeight-el.clientHeight;
  },[armedTrackId]);
  const point=(e:React.PointerEvent<HTMLElement>|React.MouseEvent<HTMLElement>,lane:HTMLElement,snapping=true)=>{
    const raw=Math.max(0,Math.min(duration,(e.clientX-lane.getBoundingClientRect().left)/scale));return snapping&&snap&&!e.altKey?nearestBeat(raw,project):raw;
  };
  const at=(track:Track,seconds:number)=>track.clips.find(clip=>seconds>=clip.start+track.offset&&seconds<clip.end+track.offset);
  const labels=project.score?project.score.route.map(m=>({seconds:qToSeconds(m.q,project.scoreMap),label:m.number,small:m.pass>1?`·${m.pass}`:''})):Array.from({length:Math.ceil(duration/5)},(_,i)=>({seconds:i*5,label:formatTime(i*5),small:''}));
  return <div ref={scroller} className="timeline-scroll" onWheel={e=>{if(!e.ctrlKey&&(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY))){followLeft.current=null;onFollow(false);}}}>
    <div className="timeline-content" style={{width:LABEL+width}}>
      <div className="ruler-row"><div className="track-label ruler-label">{t('小节 · 音轨','Bars · Tracks')}</div><div className="ruler" style={{width}} onPointerDown={e=>onSeek(point(e,e.currentTarget))}>
        {labels.filter((l,i)=>i===0||l.seconds*scale-labels[i-1].seconds*scale>22||i%2===0).map((l,i)=><span key={i} style={{left:l.seconds*scale}}>{l.label}<small>{l.small}</small></span>)}
      </div></div>
      {project.tracks.map(track=><div className={`track-row color-${track.color%4} ${project.selection?.trackId===track.id?'is-selected':''} ${armedTrackId===track.id?'is-armed':''} ${activeRecording?.trackId===track.id?'is-recording':''}`} key={track.id} data-track-id={track.id}>
        <div className="track-label"><div className="track-name"><button className="text-button" disabled={locked} onClick={()=>onTrackSettings(track.id)} title={t('音轨设置','Track settings')}>{track.name}</button><span className="role-label">{track.role==='backing'?t('伴奏','Backing'):track.role==='demo'?t('示范录音','Demo recording'):'REC'}</span></div>
          <div className="track-controls">{track.role==='recording'&&<button className="track-arm" disabled={locked} aria-label={`${t('录音待命','Arm recording')} ${track.name}`} aria-pressed={armedTrackId===track.id} title={t('将此轨设为录音目标','Record into this track')} onClick={()=>onArm(track.id)}>R</button>}<button disabled={locked} className={track.mute?'active':''} aria-label={`${t('静音','Mute')} ${track.name}`} aria-pressed={track.mute} onClick={()=>onTrack(track.id,{mute:!track.mute})}>M</button><button disabled={locked} className={track.solo?'active':''} aria-label={`${t('独奏','Solo')} ${track.name}`} aria-pressed={track.solo} onClick={()=>onTrack(track.id,{solo:!track.solo})}>S</button><input aria-label={`${track.name} ${t('音量','volume')}`} disabled={locked} type="range" min="0" max="1.5" step=".01" value={track.volume} onChange={e=>onTrack(track.id,{volume:Number(e.target.value)})}/></div>
        </div>
        <div className={`track-lane ${track.mute?'is-muted':''}`} style={{width}} tabIndex={0} aria-label={`${track.name} ${t('时间轴','timeline')}`}
          onPointerDown={e=>{if(locked||e.button!==0)return;const clip=at(track,point(e,e.currentTarget,false)),section=clip?clipSelection(track,clip):null,start=point(e,e.currentTarget);drag.current={start:section?clamp(start,section.start,section.end):start,section,downX:e.clientX,moved:false};onSelect(section);e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerMove={e=>{const end=point(e,e.currentTarget);setHover(end);const d=drag.current;if(!d?.section||Math.abs(e.clientX-d.downX)<4)return;d.moved=true;const to=clamp(end,d.section.start,d.section.end);if(Math.abs(to-d.start)>1e-7)onSelect({...d.section,start:Math.min(d.start,to),end:Math.max(d.start,to)});}}
          onPointerUp={e=>{const d=drag.current;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(d&&!d.section&&!d.moved)onSeek(d.start);}}
          onPointerCancel={()=>drag.current=null}
          onPointerLeave={()=>setHover(null)}
          onContextMenu={e=>{e.preventDefault();if(locked)return;const p=point(e,e.currentTarget,false),clip=at(track,p);if(!clip)return;if(project.selection?.clipId!==clip.id||p<project.selection.start||p>project.selection.end)onSelect(clipSelection(track,clip));onContext(e.clientX,e.clientY);}}
          onKeyDown={e=>{if(locked)return;if(e.shiftKey&&e.key==='F10'){e.preventDefault();const clip=at(track,position);if(project.selection?.trackId!==track.id){if(!clip)return;onSelect(clipSelection(track,clip));}const r=e.currentTarget.getBoundingClientRect();onContext(r.left+40,r.top+20);}if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();onSeek(Math.max(0,Math.min(duration,position+(e.key==='ArrowRight'?1:-1)*.25)));}}}>
          <div className="lane-grid" aria-hidden="true">{labels.map((label,index)=><i key={index} style={{left:label.seconds*scale}}/>)}</div>
          {track.clips.map(clip=><div className={`audio-clip ${project.selection?.clipId===clip.id&&project.selection.trackId===track.id?'is-selected':''}`} key={clip.id} data-clip-id={clip.id} role="button" tabIndex={locked?-1:0} aria-disabled={locked} aria-label={`${t('选择片段','Select region')} ${clip.label}`} aria-pressed={project.selection?.clipId===clip.id&&project.selection.trackId===track.id} style={{left:(clip.start+track.offset)*scale,width:(clip.end-clip.start)*scale}} title={`${clip.label} · ${formatTime(clip.end-clip.start,true)}`} onKeyDown={e=>{if(!locked&&(e.key==='Enter'||e.key===' '||e.shiftKey&&e.key==='F10')){e.preventDefault();e.stopPropagation();onSelect(clipSelection(track,clip));if(e.key==='F10'){const r=e.currentTarget.getBoundingClientRect();onContext(r.left+20,r.top+20);}}}}><span>{clip.label}</span><Wave clip={clip} wave={waveforms.get(clip.assetId)} color={track.color} width={(clip.end-clip.start)*scale}/>{clip.fadeIn>0&&<i className="fade-in" style={{width:clip.fadeIn*scale}}/>}{clip.fadeOut>0&&<i className="fade-out" style={{width:clip.fadeOut*scale}}/>}</div>)}
          {!track.clips.length&&activeRecording?.trackId!==track.id&&<span className="lane-placeholder">{armedTrackId===track.id?t('已待命 · 按录音开始','Ready · press Record to begin'):t('点击 R 设为录音目标','Press R on this track to arm')}</span>}
          {activeRecording?.trackId===track.id&&<div className="recording-region" style={{left:activeRecording.start*scale,width:Math.max(4,(position-activeRecording.start)*scale)}}><span>{counting?t('预备拍','Count-in'):t('正在录音','Recording')}</span></div>}
          {project.selection&&(!project.selection.trackId||project.selection.trackId===track.id)&&<div className="lane-selection" style={{left:project.selection.start*scale,width:(project.selection.end-project.selection.start)*scale}}/>}
        </div>
      </div>)}
      {!project.tracks.length&&<div className="timeline-empty">{t('添加音频，或点击「＋ 录音轨」准备录音。','Add audio or choose + Recording track to prepare a take.')}</div>}
      <div className="timeline-playhead" style={{left:LABEL+position*scale}}><span/></div>
      {hover!==null&&<div className="timeline-hover" style={{left:LABEL+hover*scale}}/>}
    </div>
  </div>;
}
