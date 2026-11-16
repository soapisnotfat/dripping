import {useEffect,useRef,useState,type ReactNode} from 'react';
import {zip,strToU8} from 'fflate';
import type {Project,Locale,Asset,Anchor,Alignment,PCM,Track} from '../lib/types';
import {clone,uid} from '../lib/types';
import {addFiles,guessRole,type ImportItem,audioAsset,editProject,renderExport,originalTake} from '../lib/project';
import {newProject,importProject,exportProject,download} from '../lib/storage';
import {transport} from '../lib/transport';
import {audioJobs} from '../lib/jobs';
import type {Features} from '../lib/alignment';
import {mono,encodeWav,mixTracks} from '../lib/audio';
import {tempoMap,validateAnchors,qToSeconds,projectDuration,musicalLabel,musicalPositionAt,musicalPositionSeconds,secondsToQ,type MusicalPosition,scorePositionLabel} from '../lib/time';
import {MusicalEndpoint} from './SelectionEditor';
import {audibleTrackIds} from '../lib/mix';
import {amplitudeDb,planMaster,type AudioStats,type MasterPlan} from '../lib/master';

export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
  const closeRef=useRef(onClose),dialog=useRef<HTMLElement>(null),previous=useRef(document.activeElement as HTMLElement);closeRef.current=onClose;
  useEffect(()=>{if(!dialog.current?.contains(document.activeElement))(dialog.current?.querySelector<HTMLElement>('[data-dialog-autofocus]')||dialog.current?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)'))?.focus();const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')closeRef.current();};document.addEventListener('keydown',fn);return()=>{document.removeEventListener('keydown',fn);(previous.current?.isConnected?previous.current:document.querySelector<HTMLElement>('[data-modal-focus-fallback]'))?.focus();};},[]);
  return <div className="modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={dialog} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'wide':''}`} onKeyDown={e=>{if(e.key!=='Tab')return;const els=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea:not(:disabled)')).filter(n=>n.offsetParent!==null);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}>
    <header><h2>{title}</h2><button className="icon-button" aria-label="Close / 关闭" onClick={onClose}>×</button></header>{children}
  </section></div>;
}
type Common={locale:Locale;onClose:()=>void;onError:(text:string)=>void};
export function ImportDialog({project,locale,onClose,onError,onOpen,initialFiles=[]}:Common&{project?:Project;onOpen:(p:Project)=>void;initialFiles?:File[]}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const [name,setName]=useState(project?.name||''),[items,setItems]=useState<ImportItem[]>(initialFiles.map(file=>({file,role:guessRole(file.name)}))),[busy,setBusy]=useState('');
  const add=(files:File[])=>{setItems(prev=>[...prev,...files.map(file=>({file,role:guessRole(file.name)}))]);if(!name&&files[0])setName(files[0].name.replace(/\.[^.]+$/,''));};
  const hasScore=!!project?.score||items.some(item=>item.role==='score'),archiveOnly=items.length===1&&/\.drippingproj$/i.test(items[0].file.name);
  const submit=async()=>{try{
    setBusy(t('创建项目…','Creating project…'));
    const archive=items.find(i=>/\.drippingproj$/i.test(i.file.name));
    if(archive){if(items.length!==1)throw Error(t('项目备份需单独打开','Open a project backup on its own'));onOpen(await importProject(archive.file));return;}
    if(!hasScore)throw Error(t('请先添加 MusicXML 乐谱','Add a MusicXML score first'));
    const p=project||newProject(name.trim()||t('未命名练习','Untitled practice'));onOpen(await addFiles(p,items,setBusy));
  }catch(e){onError(String(e));setBusy('');}};
  return <Modal title={project?t('添加素材','Add files'):t('新的练习','A new practice')} onClose={()=>{if(!busy)onClose();}}>
    {!project&&<label className="field">{t('项目名称','Project name')}<input autoFocus data-dialog-autofocus value={name} placeholder={t('今天想练什么？','What are you playing today?')} onChange={e=>setName(e.target.value)}/></label>}
    <label className="drop-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add([...e.dataTransfer.files]);}}><span className="drop-symbol">＋</span><strong>{t('放入乐谱、伴奏和示范','Drop your score, backing and demo')}</strong><span>MusicXML / MXL · WAV / MP3 / M4A / FLAC</span><input aria-label={t('选择素材','Choose files')} type="file" multiple accept=".musicxml,.mxl,.xml,.drippingproj,audio/*" onChange={e=>{add([...e.target.files||[]]);e.target.value='';}}/></label>
    <div className="import-list">{items.map((item,i)=><div key={i}><span title={item.file.name}>{item.file.name}<small>{(item.file.size/1024/1024).toFixed(1)} MB</small></span>{! /\.drippingproj$/i.test(item.file.name)&&<select aria-label={`${item.file.name} role`} value={item.role} onChange={e=>setItems(rows=>rows.map((r,j)=>i===j?{...r,role:e.target.value as ImportItem['role']}:r))}><option value="score">{t('乐谱','Score')}</option><option value="backing">{t('伴奏','Backing')}</option><option value="demo">{t('示范录音','Demo recording')}</option></select>}<button className="icon-button" aria-label={t('移除','Remove')} onClick={()=>setItems(rows=>rows.filter((_,j)=>i!==j))}>×</button></div>)}</div>
    {!hasScore&&!archiveOnly&&<p className="muted">{t('先放入乐谱，练习与录音都跟随谱面的小节、拍与速度。','Add a score first. Practice and recording follow its bars, beats and tempo.')}</p>}
    <p className="muted">{t('素材保存在当前浏览器。也可以选择 .drippingproj 恢复完整项目。','Files stay in this browser. Open a .drippingproj file to restore a project.')}</p>
    <footer><span className="busy-text">{busy}</span><button className="primary" disabled={!!busy||(!hasScore&&!archiveOnly)||(!items.length&&!!project)} onClick={submit}>{busy?t('正在导入…','Importing…'):t('开始练习','Start practicing')}</button></footer>
  </Modal>;
}

export function AlignmentDialog({project,locale,onClose,onError,onCommit,initialTrack}:Common&{project:Project;onCommit:(p:Project,assets?:Asset[])=>Promise<void>;initialTrack?:string}){
  const text=(zh:string,en:string)=>locale==='zh'?zh:en;
  const available=project.tracks.filter((track):track is Track&{sourceAssetId:string}=>track.role!=='recording'&&!!track.sourceAssetId),score=project.score!;
  const [id,setId]=useState(available.find(track=>track.id===initialTrack)?.id||available[0]?.id||'');
  const activeTrack=useRef(id);activeTrack.current=id;
  const track=available.find(track=>track.id===id),[candidate,setCandidate]=useState<Alignment|undefined>(track?.alignment),[busy,setBusy]=useState(''),[status,setStatus]=useState('');
  const [scoreAt,setScoreAt]=useState<MusicalPosition>({location:'0',value:'1'}),[audioAt,setAudioAt]=useState<MusicalPosition>({location:'0',value:'1'});
  const previewId=useRef(`alignment-preview-${uid()}`);
  useEffect(()=>()=>{transport.pause();transport.pcm.delete(previewId.current);},[]);
  const features=async(assetId:string)=>audioJobs.run<Features>('features',{samples:mono(await transport.asset(assetId)),sampleRate:11025,hop:.12});
  const analyze=async()=>{if(!track)return;const operationTrack=track.id;try{setBusy(text('分析音高与节奏…','Analyzing pitch and timing…'));
    const demo=available.find(other=>other.role==='demo'&&other.id!==id&&other.alignment?.status==='accepted'),audio=await features(track.sourceAssetId);
    const result=demo?await audioJobs.run<Alignment>('align-demo',{score,demo:await features(demo.sourceAssetId),demoMap:demo.alignment!.anchors,features:audio}):await audioJobs.run<Alignment>('align',{score,features:audio});
    if(activeTrack.current!==operationTrack)return;setCandidate(result);setStatus(text('匹配完成，核对后将本轨对齐到谱面。','Candidate ready. Check it, then align this track to the score.'));
  }catch(error){onError(String(error));}finally{setBusy('');}};
  const manual=()=>setCandidate({anchors:tempoMap(score),manualAnchors:[],method:'manual',status:'candidate',warnings:[]});
  const anchors=candidate?.anchors||[];
  const addAnchor=()=>{try{const at=musicalPositionSeconds(scoreAt,score,project.scoreMap),source=musicalPositionSeconds(audioAt,score,project.scoreMap),q=secondsToQ(at,project.scoreMap);
    const copy=anchors.filter(anchor=>Math.abs(anchor.q-q)>.00001).concat({q,seconds:source}).sort((a,b)=>a.q-b.q);validateAnchors(copy);const edited=candidate?.manualAnchors??(candidate?.method==='manual'&&anchors.length<=32?anchors.map(anchor=>anchor.q):[]);setCandidate({...candidate!,anchors:copy,manualAnchors:[...new Set([...edited.filter(at=>Math.abs(at-q)>.00001),q])].sort((a,b)=>a-b),method:'manual',status:'candidate'});
  }catch(error){onError(String(error));}};
  const render=async()=>{if(!candidate||!track)throw Error(text('先匹配音轨','Match a track first'));validateAnchors(candidate.anchors);return audioJobs.run<PCM>('conform',{pcm:await transport.asset(track.sourceAssetId),sourceMap:candidate.anchors,targetMap:project.scoreMap,duration:projectDuration(project),score,manualAnchors:candidate.manualAnchors??(candidate.method==='manual'&&candidate.anchors.length<=32?candidate.anchors.map(anchor=>anchor.q):[])});};
  const conform=async()=>{if(!candidate||!track)return;try{setBusy(text('按谱面保调校正…','Aligning to the score, preserving pitch…'));transport.pause();
    const rendered=await render(),asset=audioAsset(project,rendered,`${track.name} — aligned.wav`),duration=projectDuration(project);
    const next=editProject(project,'align to score',p=>{const tr=p.tracks.find(track=>track.id===id)!;tr.offset=0;tr.clips=[{id:uid(),assetId:asset.id,label:track.name,start:0,end:duration,sourceStart:0,rate:1,gain:1,fadeIn:.005,fadeOut:.005}];tr.alignment={...candidate,status:'accepted'};});
    next.assetIds.push(asset.id);transport.pcm.set(asset.id,rendered);await onCommit(next,[asset]);setCandidate({...candidate,status:'accepted'});setStatus(text('已按谱面对齐。原始素材保留，可撤销。','Aligned to the score. Original audio is retained; undo is available.'));
  }catch(error){onError(String(error));}finally{setBusy('');}};
  const preview=async()=>{if(!track)return;try{setBusy(text('准备对齐试听…','Preparing aligned audition…'));const rendered=await render();transport.pcm.set(previewId.current,rendered);
    const p=clone(project);p.tracks=p.tracks.map(other=>({...other,mute:other.id!==id,solo:false,offset:0,clips:other.id===id?[{id:'preview',assetId:previewId.current,label:other.name,start:0,end:projectDuration(p),sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0}]:other.clips}));p.loop=false;transport.reference=true;await transport.start(p,musicalPositionSeconds(scoreAt,score,project.scoreMap));setStatus(text('正在试听对齐结果与谱面合成音。','Auditioning the aligned track with score synth.'));
  }catch(error){onError(String(error));}finally{setBusy('');}};
  return <Modal title={text('乐谱与音频对齐','Score & audio alignment')} onClose={()=>{if(!busy){transport.pause();transport.reference=false;onClose();}}} wide>
    <div className="alignment-top"><label className="field">{text('音轨','Track')}<select disabled={!!busy} value={id} onChange={event=>{transport.pause();setId(event.target.value);setCandidate(available.find(track=>track.id===event.target.value)?.alignment);setStatus('');}}>{available.map(track=><option key={track.id} value={track.id}>{track.name}</option>)}</select></label><button disabled={!!busy||!track} onClick={analyze}>{text('自动匹配','Analyze audio')}</button><button disabled={!!busy||!track} onClick={manual}>{text('按谱速手动设置','Set anchors manually')}</button></div>
    <p className="muted">{text('谱面的小节、拍号和速度始终是基准。音频位置也按谱速显示；将对应的音乐位置配对，再校正音轨。','Score bars, meter and tempo always set the clock. Audio positions use score tempo too; pair matching musical moments, then align the track.')}</p>
    <div className="status-line">{busy||status}</div>
    {candidate&&<><div className="anchor-add">
      <MusicalEndpoint name="score" label={text('谱面位置','Score position')} position={scoreAt} score={score} map={project.scoreMap} locale={locale} disabled={!!busy} onChange={setScoreAt}/>
      <MusicalEndpoint allowOutside name="audio" label={text('音频位置','Audio position')} position={audioAt} score={score} map={project.scoreMap} locale={locale} disabled={!!busy} onChange={setAudioAt}/>
      <button disabled={!!busy} onClick={addAnchor}>{text('添加／更新点','Add / update anchor')}</button><button disabled={!!busy} onClick={preview}>{text('试听对齐结果','Audition alignment')}</button></div>
      {candidate.warnings.map(warning=><p className="warning" key={warning}>{warning}</p>)}
      <div className="anchor-table"><table><thead><tr><th>{text('谱面小节·拍','Score bar · beat')}</th><th>{text('音频小节·拍（按谱速）','Audio bar · beat (score tempo)')}</th><th/></tr></thead><tbody>{anchors.map((anchor,index)=><tr key={index}><td><button disabled={!!busy} onClick={()=>{setScoreAt(musicalPositionAt(qToSeconds(anchor.q,project.scoreMap),score,project.scoreMap));setAudioAt(musicalPositionAt(anchor.seconds,score,project.scoreMap));}}>{scorePositionLabel(anchor.q,score,locale)}</button></td><td>{musicalLabel(anchor.seconds,project,locale)}</td><td><button disabled={!!busy||anchors.length<=2} aria-label={text('删除对齐点','Remove anchor')} onClick={()=>setCandidate({...candidate,anchors:anchors.filter((_,i)=>i!==index),manualAnchors:candidate.manualAnchors?.filter(q=>Math.abs(q-anchor.q)>1e-7),status:'candidate'})}>×</button></td></tr>)}</tbody></table></div>
      <footer><button className="primary" disabled={!!busy} onClick={conform}>{text('将本轨对齐到谱面','Align track to score')}</button></footer></>}
  </Modal>;
}

export function ExportDialog({project,locale,onClose,onError}:Common&{project:Project}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const [busy,setBusy]=useState(''),[status,setStatus]=useState(''),[range,setRange]=useState(false),[selected,setSelected]=useState(()=>audibleTrackIds(project.tracks)),[speed,setSpeed]=useState(1);
  const [bitDepth,setBitDepth]=useState<24|32>(24),[ceiling,setCeiling]=useState(-1),[matchLoudness,setMatchLoudness]=useState(false),[target,setTarget]=useState(-18);
  const [analysis,setAnalysis]=useState<{key:string;stats:AudioStats}|null>(null),cache=useRef<{key:string;pcm:PCM;stats:AudioStats}|null>(null);
  const audible=new Set(audibleTrackIds(project.tracks)),solo=project.tracks.some(track=>track.solo);
  const a=range&&project.selection?project.selection.start:0,b=range&&project.selection?project.selection.end:projectDuration(project);
  const key=JSON.stringify([project.revision,selected,a,b,speed]),stats=analysis?.key===key?analysis.stats:null;
  const settings={gainDb:project.masterGainDb??0,ceilingDb:ceiling,targetLufs:matchLoudness?target:undefined},plan=stats?planMaster(stats,settings):null;
  const safe=(s:string)=>s.replace(/[\\/:*?"<>|]/g,'_').slice(0,100),db=(value:number)=>value>0?amplitudeDb(value).toFixed(1):'−∞';
  const getMix=async()=>{
    if(cache.current?.key===key)return cache.current;
    if(!project.score||project.score.tempoMissing)throw Error(t('请先添加乐谱并确认谱面速度','Add a score and confirm its tempo first'));
    const tracks=project.tracks.filter(track=>selected.includes(track.id));if(!tracks.length)throw Error(t('至少选择一条音轨','Choose at least one track'));
    const rendered:PCM[]=[];
    for(const track of tracks){setBusy(track.name);rendered.push(await renderExport(project,track,a,b,true,speed));}
    setBusy(t('分析响度与真峰值…','Analyzing loudness and true peak…'));
    const pcm=mixTracks(rendered),stats=await audioJobs.run<AudioStats>('measure-export',{pcm});
    const result={key,pcm,stats};cache.current=result;setAnalysis({key,stats});return result;
  };
  const analyze=async()=>{try{setBusy(t('准备分析…','Preparing analysis…'));await getMix();}catch(error){onError(String(error));}finally{setBusy('');}};
  const startDownload=(blob:Blob,name:string)=>{download(blob,name);setStatus(t('已生成并开始下载：','Generated and download started: ')+name);};
  const perform=async(kind:'stems'|'mix'|'project')=>{try{setStatus('');setBusy(t('正在准备导出…','Preparing export…'));
    if(kind==='project'){startDownload(await exportProject(project),`${safe(project.name)}.drippingproj`);return;}
    if(!project.score||project.score.tempoMissing)throw Error(t('请先添加乐谱并确认谱面速度','Add a score and confirm its tempo first'));
    const tracks=project.tracks.filter(track=>selected.includes(track.id));if(!tracks.length)throw Error(t('至少选择一条音轨','Choose at least one track'));
    if(kind==='mix'){
      const {pcm,stats}=await getMix();setBusy(t('生成高品质 WAV…','Encoding WAV…'));
      const result=await audioJobs.run<{wav:ArrayBuffer;plan:MasterPlan}>('master-wav',{pcm,stats,settings,bitDepth});
      startDownload(new Blob([result.wav],{type:'audio/wav'}),`${safe(project.name)} — mix.wav`);
    }else{
      const files:Record<string,Uint8Array>={};
      for(let i=0;i<tracks.length;i++){setBusy(tracks[i].name);const pcm=await renderExport(project,tracks[i],a,b,false,speed);files[`${String(i+1).padStart(2,'0')} ${safe(tracks[i].name)}.wav`]=new Uint8Array(encodeWav(pcm,32));}
      files['session.json']=strToU8(JSON.stringify({project:project.name,range:{start:a,end:b},sampleRate:48000,bitDepth:32,format:'IEEE float WAV',speed,masterGainDb:project.masterGainDb??0,alignment:'All files share the same zero and length',tracks:tracks.map(track=>({name:track.name,role:track.role,volume:track.volume,pan:track.pan}))},null,2));
      const data=await new Promise<Uint8Array>((resolve,reject)=>zip(files,{level:0},(error,out)=>error?reject(error):resolve(out)));startDownload(new Blob([data as Uint8Array<ArrayBuffer>],{type:'application/zip'}),`${safe(project.name)} — stems.zip`);
    }
  }catch(error){onError(String(error));}finally{setBusy('');}};
  return <Modal title={t('带走你的练习','Export your practice')} onClose={()=>{if(!busy)onClose();}}>
    <p className="muted">{t('混音默认 48 kHz／24-bit WAV；分轨为 48 kHz／32-bit float WAV，共同起点和长度。','Mixes default to 48 kHz / 24-bit WAV. Stems use 48 kHz / 32-bit float WAV with a shared start and length.')}</p>
    <button className="export-reset" disabled={!!busy} onClick={()=>setSelected(audibleTrackIds(project.tracks))}>{t('按当前播放音轨选择','Select currently audible tracks')}</button>
    <div className="check-list">{project.tracks.map(track=><label key={track.id}><input type="checkbox" disabled={!!busy} checked={selected.includes(track.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,track.id]:ids.filter(id=>id!==track.id))}/><span>{track.name}<small className="export-track-state">{!track.clips.length?t('无片段','No clips'):track.mute?t('已静音','Muted'):solo&&!track.solo?t('被其他轨独奏排除','Excluded by solo'):track.solo?t('独奏','Solo'):t('播放','Audible')}{selected.includes(track.id)&&!audible.has(track.id)?t(' · 已手动加入导出',' · explicitly included'):''}</small></span></label>)}</div>
    <label className="field">{t('导出速度','Export speed')}<select disabled={!!busy} aria-label={t('导出速度','Export speed')} value={speed} onChange={event=>setSpeed(Number(event.target.value))}><option value="1">{t('原速 · 100%','Original · 100%')}</option>{project.speed!==1&&<option value={project.speed}>{t('当前练习速度','Current practice speed')} · {Math.round(project.speed*100)}%</option>}</select></label>
    <label className="check"><input type="checkbox" checked={range} disabled={!project.selection||!!busy} onChange={event=>setRange(event.target.checked)}/>{t('只导出选区','Export selection only')} · {musicalLabel(a,project,locale)}–{musicalLabel(b,project,locale)}</label>
    <div className="mix-quality">
      <label>{t('混音格式','Mix format')}<select aria-label={t('混音格式','Mix format')} disabled={!!busy} value={bitDepth} onChange={event=>setBitDepth(Number(event.target.value) as 24|32)}><option value="24">24-bit PCM WAV</option><option value="32">32-bit float WAV</option></select></label>
      <label>{t('混音峰值上限','Mix peak ceiling')}<select aria-label={t('混音峰值上限','Mix peak ceiling')} disabled={!!busy} value={ceiling} onChange={event=>setCeiling(Number(event.target.value))}>{[-1,-2,-3,-6].map(value=><option key={value} value={value}>{value} dBTP</option>)}</select></label>
      <label className="check"><input type="checkbox" disabled={!!busy} checked={matchLoudness} onChange={event=>setMatchLoudness(event.target.checked)}/>{t('匹配整体响度','Match integrated loudness')}</label>
      {matchLoudness&&<label>{t('目标响度','Target loudness')}<select aria-label={t('目标响度','Target loudness')} disabled={!!busy} value={target} onChange={event=>setTarget(Number(event.target.value))}>{[-23,-20,-18,-16,-14].map(value=><option key={value} value={value}>{value} LUFS</option>)}</select></label>}
      {matchLoudness&&<small>{t('以目标响度为准，替代主输出增益。','The loudness target replaces main output gain.')}</small>}
    </div>
    <button disabled={!!busy||!selected.length} onClick={()=>void analyze()}>{t('分析混音','Analyze mix')}</button>
    {plan&&<div className="mix-analysis" aria-label={t('预计导出电平','Planned export levels')}><dl><dt>{t('整体响度','Integrated loudness')}</dt><dd>{plan.lufs===null?'—':`${plan.lufs.toFixed(1)} LUFS-I`}</dd><dt>{t('真峰值估计','Estimated true peak')}</dt><dd>{db(plan.truePeak)} dBTP</dd><dt>{t('采样峰值','Sample peak')}</dt><dd>{db(plan.samplePeak)} dBFS</dd><dt>{t('最终混音增益','Final mix gain')}</dt><dd>{plan.gainDb>0?'+':''}{plan.gainDb.toFixed(1)} dB</dd></dl>{plan.reductionDb>.01&&<p>{t('为保留峰值余量，整体降低','Overall reduction for peak headroom: ')} {plan.reductionDb.toFixed(1)} dB{locale==='zh'?'。':'.'}</p>}{plan.targetLimited&&<p>{t('峰值上限优先，响度低于所选目标。','The peak ceiling takes priority; loudness stays below the selected target.')}</p>}{matchLoudness&&plan.lufs===null&&<p>{t('片段过短或无有效信号，未匹配响度。','Too short or no gated signal; loudness matching is unavailable.')}</p>}</div>}
    <p className="muted compact">{t('混音套用推子、声像与主输出增益；峰值保护及响度匹配只改变整体增益，保留演奏动态。分轨不套用这些增益。仅导出勾选音轨，不包含谱面合成音和节拍器。','Mixes apply faders, pan and main output gain. Peak protection and loudness matching use constant gain to preserve dynamics. Stems exclude these gains. Only checked tracks are exported; score synth and click are excluded.')}</p>
    <footer className="wrap"><button disabled={!!busy||!selected.length} onClick={()=>perform('stems')}>{t('分轨 WAV','WAV stems')}</button><button disabled={!!busy||!selected.length} onClick={()=>perform('mix')}>{t('混音 WAV','Mix WAV')}</button><button className="primary" disabled={!!busy} onClick={()=>perform('project')}>{t('完整项目备份','Project backup')}</button></footer><p className="export-status" role="status" aria-live="polite">{busy||status}</p>
    {!!project.takes.length&&<details><summary>{t('每次录音的原始干声','Original dry takes')} ({project.takes.length})</summary>{project.takes.map(take=><div className="take-row" key={take.id}><span>{take.name} · {take.speed}× · {take.sampleRate/1000} kHz · {take.channels} ch · {take.interrupted?t('已恢复','Recovered'):t('原始干声','Original dry audio')}</span><button disabled={!!busy} onClick={async()=>{try{startDownload(await originalTake(take.assetId),`${safe(take.name)} — dry.wav`);}catch(error){onError(String(error));}}}>{t('下载原声','Download dry')}</button></div>)}</details>}
  </Modal>;
}
