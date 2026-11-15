import {useRef} from 'react';
import type {Clip,Locale,Project,Track} from '../lib/types';
import {clamp} from '../lib/types';
import {nearestBeat} from '../lib/time';
import {clipTrimBounds} from '../lib/timeline';

export function TrimHandles({project,track,clip,preview,sourceDuration,scale,snap,locale,onPreview,onTrim}:{project:Project;track:Track;clip:Clip;preview?:Clip;sourceDuration?:number;scale:number;snap:boolean;locale:Locale;onPreview:(clip:Clip|null)=>void;onTrim:(start:number,end:number)=>void}){
  const drag=useRef<{edge:'start'|'end';x:number;clip:Clip}|null>(null),draft=useRef<Clip|null>(null),t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const bounds=clipTrimBounds(track,clip,sourceDuration),shown=preview??clip,minimum=Math.min(.01,shown.end-shown.start);
  const resize=(original:Clip,edge:'start'|'end',seconds:number)=>{
    const minimum=Math.min(.01,original.end-original.start),raw=seconds-track.offset;
    const value=clamp(raw,edge==='start'?bounds.start:original.start+minimum,edge==='start'?original.end-minimum:bounds.end);
    return {...original,[edge]:value,sourceStart:edge==='start'?Math.max(0,original.sourceStart+(value-original.start)*original.rate):original.sourceStart};
  };
  const commit=(next:Clip)=>{if(Math.abs(next.start-clip.start)>1e-7||Math.abs(next.end-clip.end)>1e-7)onTrim(next.start+track.offset,next.end+track.offset);};
  const cancel=()=>{drag.current=null;draft.current=null;onPreview(null);};
  return <>{(['start','end'] as const).map(edge=><button type="button" key={edge} className={`trim-handle trim-${edge}`} role="slider" aria-label={`${t('裁剪','Trim')} ${clip.label} ${edge==='start'?t('左边缘','left edge'):t('右边缘','right edge')}`} aria-valuemin={(edge==='start'?bounds.start:shown.start+minimum)+track.offset} aria-valuemax={(edge==='start'?shown.end-minimum:bounds.end)+track.offset} aria-valuenow={shown[edge]+track.offset} aria-valuetext={`${(shown[edge]+track.offset).toFixed(3)} s`} style={{left:(shown[edge]+track.offset)*scale-(edge==='end'?20:0)}}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();drag.current={edge,x:event.clientX,clip};draft.current=null;event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{event.stopPropagation();const active=drag.current;if(!active)return;const raw=active.clip[active.edge]+track.offset+(event.clientX-active.x)/scale,next=resize(active.clip,active.edge,snap&&!event.altKey?nearestBeat(raw,project):raw);draft.current=next;onPreview(next);}}
    onPointerUp={event=>{event.stopPropagation();const next=draft.current;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);cancel();if(next)commit(next);}}
    onPointerCancel={cancel}
    onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();cancel();return;}if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();commit(resize(clip,edge,clip[edge]+track.offset+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?.01:.1)));}}}
  ><i aria-hidden="true"/></button>)}</>;
}
