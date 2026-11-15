import {useEffect,useState} from 'react';
import type {Locale,Project,Selection} from '../lib/types';
import {projectDuration,scorePositionLabel,secondsToQ} from '../lib/time';

export function SelectionEditor({project,locale,trackId,disabled,onSelect}:{project:Project;locale:Locale;trackId:string;disabled:boolean;onSelect:(selection:Selection|null)=>void}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en,selection=project.selection,duration=projectDuration(project);
  const [start,setStart]=useState(String(selection?.start??0)),[end,setEnd]=useState(String(selection?.end??duration)),[error,setError]=useState(''),[editTrack,setEditTrack]=useState(trackId);
  useEffect(()=>{setStart(String(selection?.start??0));setEnd(String(selection?.end??duration));setError('');},[selection?.start,selection?.end,project.id,duration]);
  useEffect(()=>setEditTrack(trackId),[trackId]);
  const label=(value:string)=>project.score?scorePositionLabel(secondsToQ(Number(value),project.scoreMap),project.score,locale):'';
  return <form className="selection-editor" onSubmit={event=>{
    event.preventDefault();const a=Number(start),b=Number(end);
    if(start.trim()===''||end.trim()===''||!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a||b>duration+.000001){setError(t('选区需在项目内，且终点晚于起点。','Keep the range within the project, with the end after the start.'));return;}
    onSelect({...selection,start:a,end:b,trackId:editTrack});setError('');
  }}>
    <label>{t('编辑轨','Edit track')}<select aria-label={t('选区编辑轨','Selection edit track')} value={editTrack} disabled={disabled||!project.tracks.length} onChange={e=>{setEditTrack(e.target.value);if(selection)onSelect({...selection,trackId:e.target.value});}}>{project.tracks.map(track=><option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
    <label>{t('起点（秒）','Start (seconds)')}<input type="number" step="any" min="0" value={start} disabled={disabled} onChange={e=>setStart(e.target.value)}/><small>{label(start)}</small></label>
    <label>{t('终点（秒）','End (seconds)')}<input type="number" step="any" min="0" value={end} disabled={disabled} onChange={e=>setEnd(e.target.value)}/><small>{label(end)}</small></label>
    <button disabled={disabled} type="submit">{selection?t('应用范围','Apply range'):t('建立选区','Create range')}</button>
    <span className="selection-loop-state">{!selection?t('尚未建立选区','No active range'):project.loop?t('循环已开','Loop on'):t('循环未开','Loop off')}</span>
    <button disabled={disabled||!selection} type="button" onClick={()=>onSelect(null)}>{t('取消选区','Deselect')}</button>
    {error&&<span role="alert" className="selection-error">{error}</span>}
  </form>;
}
