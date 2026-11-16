import {useEffect,useState} from 'react';
import type {Anchor,Locale,Project,Score,Selection} from '../lib/types';
import {musicalPositionAt,musicalPositionSeconds,projectDuration,qToSeconds,type MusicalPosition} from '../lib/time';
import {clipSelection} from '../lib/timeline';

export function MusicalEndpoint({label,position,score,locale,disabled,onChange,allowOutside=false}:{name:string;label:string;position:MusicalPosition;score:Score;map:Anchor[];locale:Locale;disabled:boolean;onChange:(position:MusicalPosition)=>void;allowOutside?:boolean}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en,outside=position.location==='before'||position.location==='after';
  return <div className="musical-endpoint"><span>{label}{outside?t('（谱外）',' (outside score)'):t('（小节·拍）',' (bar · beat)')}</span><div className="musical-position">
    <select aria-label={locale==='zh'?label+'小节':label+' bar'} disabled={disabled} value={position.location} onChange={event=>onChange({location:event.target.value,value:/^\d+$/.test(event.target.value)?'1':'0'})}>
      {(allowOutside||position.location==='before')&&<option value="before">{t('谱前音频','Before score')}</option>}
      {score.route.map((occurrence,index)=><option key={index} value={index}>{occurrence.number}{occurrence.pass>1?` · ${t(`${occurrence.pass}遍`,`pass ${occurrence.pass}`)}`:''}</option>)}
      <option value="end">{t('谱尾','Score end')}</option>{(allowOutside||position.location==='after')&&<option value="after">{t('谱后','After score')}</option>}
    </select>
    {position.location!=='end'&&<><input aria-label={locale==='zh'?label+'拍':label+' beat'} type="number" step="any" min={outside?0:1} value={position.value} disabled={disabled} onChange={event=>onChange({location:position.location,value:event.target.value})}/><span>{t('拍','beat')}</span></>}
  </div></div>;
}

export function SelectionEditor({project,locale,trackId,disabled,onSelect}:{project:Project;locale:Locale;trackId:string;disabled:boolean;onSelect:(selection:Selection|null)=>void}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en,selection=project.selection,duration=projectDuration(project),score=project.score?.route.length?project.score:undefined;
  const initialStart=selection?.start??(score?Math.max(0,qToSeconds(0,project.scoreMap)):0),initialEnd=selection?.end??(score?Math.min(duration,qToSeconds(score.totalQ,project.scoreMap)):duration);
  const [error,setError]=useState(''),[editTrack,setEditTrack]=useState(trackId);
  const [startMusic,setStartMusic]=useState<MusicalPosition|null>(()=>score?musicalPositionAt(initialStart,score,project.scoreMap):null),[endMusic,setEndMusic]=useState<MusicalPosition|null>(()=>score?musicalPositionAt(initialEnd,score,project.scoreMap):null);
  const track=project.tracks.find(track=>track.id===editTrack),clip=selection?.trackId===editTrack?track?.clips.find(clip=>clip.id===selection.clipId):undefined,section=track&&clip?clipSelection(track,clip):null;
  useEffect(()=>{setStartMusic(score?musicalPositionAt(initialStart,score,project.scoreMap):null);setEndMusic(score?musicalPositionAt(initialEnd,score,project.scoreMap):null);setError('');},[initialStart,initialEnd,selection?.clipId,project.id,score,project.scoreMap]);
  useEffect(()=>setEditTrack(trackId),[trackId]);
  if(!score||!startMusic||!endMusic)return <p className="muted selection-editor">{t('先添加乐谱，按小节与拍建立练习。','Add a score to practice in bars and beats.')}</p>;
  return <form className="selection-editor" onSubmit={event=>{
    event.preventDefault();const a=musicalPositionSeconds(startMusic,score,project.scoreMap),b=musicalPositionSeconds(endMusic,score,project.scoreMap);
    if(!Number.isFinite(a)||!Number.isFinite(b)){setError(t('请输入所选小节内的有效拍位。','Enter a valid beat within the selected bar.'));return;}
    if(a<Math.max(0,section?.start??0)-.000001||b<=a||b>Math.min(duration,section?.end??duration)+.000001){setError(section?t('选区需在当前片段内，且终点晚于起点。','Keep the range within this region, with the end after the start.'):t('选区需在项目内，且终点晚于起点。','Keep the range within the project, with the end after the start.'));return;}
    onSelect({...selection,start:a,end:b,trackId:editTrack});setError('');
  }}>
    <label>{t('编辑轨','Edit track')}<select aria-label={t('选区编辑轨','Selection edit track')} value={editTrack} disabled={disabled||!project.tracks.length} onChange={event=>{setEditTrack(event.target.value);if(selection)onSelect({...selection,trackId:event.target.value,clipId:undefined});}}>{project.tracks.map(track=><option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
    {section&&<div className="selection-scope"><span>{t('片段：','Region: ')}{clip!.label}</span><button type="button" disabled={disabled} onClick={()=>onSelect(section)}>{t('选择整段','Select whole region')}</button></div>}
    <MusicalEndpoint name="start" label={t('起点','Start')} position={startMusic} score={score} map={project.scoreMap} locale={locale} disabled={disabled} onChange={setStartMusic}/>
    <MusicalEndpoint name="end" label={t('终点','End')} position={endMusic} score={score} map={project.scoreMap} locale={locale} disabled={disabled} onChange={setEndMusic}/>
    <button disabled={disabled} type="submit">{selection?t('应用范围','Apply range'):t('建立选区','Create range')}</button>
    <span className="selection-loop-state">{!selection?t('尚未建立选区','No active range'):project.loop?t('循环已开','Loop on'):t('循环未开','Loop off')}</span>
    <button disabled={disabled||!selection} type="button" onClick={()=>onSelect(null)}>{t('取消选区','Deselect')}</button>
    {error&&<span role="alert" className="selection-error">{error}</span>}
  </form>;
}
