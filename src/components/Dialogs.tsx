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
import {tempoMap,validateAnchors,qToSeconds,projectDuration,formatTime,scorePositionLabel} from '../lib/time';
import {audibleTrackIds} from '../lib/mix';
import {amplitudeDb,planMaster,type AudioStats,type MasterPlan} from '../lib/master';

export function Modal({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{const prev=document.activeElement as HTMLElement;const fn=(e:KeyboardEvent)=>{if(e.key==='Escape')closeRef.current();};document.addEventListener('keydown',fn);return()=>{document.removeEventListener('keydown',fn);prev?.focus();};},[]);
  return <div className="modal-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><section role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'wide':''}`} onKeyDown={e=>{if(e.key!=='Tab')return;const els=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea:not(:disabled)')).filter(n=>n.offsetParent!==null);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}>
    <header><h2>{title}</h2><button className="icon-button" aria-label="Close / 关闭" onClick={onClose}>×</button></header>{children}
  </section></div>;
}
type Common={locale:Locale;onClose:()=>void;onError:(text:string)=>void};
export function ImportDialog({project,locale,onClose,onError,onOpen,initialFiles=[]}:Common&{project?:Project;onOpen:(p:Project)=>void;initialFiles?:File[]}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const [name,setName]=useState(project?.name||''),[items,setItems]=useState<ImportItem[]>(initialFiles.map(file=>({file,role:guessRole(file.name)}))),[busy,setBusy]=useState('');
  const add=(files:File[])=>{setItems(prev=>[...prev,...files.map(file=>({file,role:guessRole(file.name)}))]);if(!name&&files[0])setName(files[0].name.replace(/\.[^.]+$/,''));};
  const submit=async()=>{try{
    setBusy(t('创建项目…','Creating project…'));
    const archive=items.find(i=>/\.drippingproj$/i.test(i.file.name));
    if(archive){if(items.length!==1)throw Error(t('项目备份需单独打开','Open a project backup on its own'));onOpen(await importProject(archive.file));return;}
    const p=project||newProject(name.trim()||t('未命名练习','Untitled practice'));onOpen(await addFiles(p,items,setBusy));
  }catch(e){onError(String(e));setBusy('');}};
  return <Modal title={project?t('添加素材','Add files'):t('新的练习','A new practice')} onClose={()=>{if(!busy)onClose();}}>
    {!project&&<label className="field">{t('项目名称','Project name')}<input autoFocus value={name} placeholder={t('今天想练什么？','What are you playing today?')} onChange={e=>setName(e.target.value)}/></label>}
    <label className="drop-zone" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add([...e.dataTransfer.files]);}}><span className="drop-symbol">＋</span><strong>{t('放入乐谱、伴奏和示范','Drop your score, backing and demo')}</strong><span>MusicXML / MXL · WAV / MP3 / M4A / FLAC</span><input aria-label={t('选择素材','Choose files')} type="file" multiple accept=".musicxml,.mxl,.xml,.drippingproj,audio/*" onChange={e=>{add([...e.target.files||[]]);e.target.value='';}}/></label>
    <div className="import-list">{items.map((item,i)=><div key={i}><span title={item.file.name}>{item.file.name}<small>{(item.file.size/1024/1024).toFixed(1)} MB</small></span>{! /\.drippingproj$/i.test(item.file.name)&&<select aria-label={`${item.file.name} role`} value={item.role} onChange={e=>setItems(rows=>rows.map((r,j)=>i===j?{...r,role:e.target.value as ImportItem['role']}:r))}><option value="score">{t('乐谱','Score')}</option><option value="backing">{t('伴奏','Backing')}</option><option value="demo">{t('示范录音','Demo recording')}</option></select>}<button className="icon-button" aria-label={t('移除','Remove')} onClick={()=>setItems(rows=>rows.filter((_,j)=>i!==j))}>×</button></div>)}</div>
    <p className="muted">{t('素材保存在当前浏览器。也可以选择 .drippingproj 恢复完整项目。','Files stay in this browser. Open a .drippingproj file to restore a project.')}</p>
    <footer><span className="busy-text">{busy}</span><button className="primary" disabled={!!busy||(!items.length&&!!project)} onClick={submit}>{busy?t('正在导入…','Importing…'):t('开始练习','Start practicing')}</button></footer>
  </Modal>;
}

export function AlignmentDialog({project,locale,onClose,onError,onCommit,initialTrack}:Common&{project:Project;onCommit:(p:Project,assets?:Asset[])=>Promise<void>;initialTrack?:string}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const available=project.tracks.filter((t):t is Track & {sourceAssetId:string}=>t.role!=='recording'&&!!t.sourceAssetId);
  const [id,setId]=useState(available.find(t=>t.id===initialTrack)?.id||available.find(t=>t.role==='demo')?.id||available[0]?.id||'');
  const track=available.find(t=>t.id===id),[candidate,setCandidate]=useState<Alignment|undefined>(track?.alignment),[busy,setBusy]=useState(''),[status,setStatus]=useState('');
  const [q,setQ]=useState('0'),[seconds,setSeconds]=useState('0');
  const choose=(trackId:string)=>{setId(trackId);setCandidate(project.tracks.find(t=>t.id===trackId)?.alignment);setStatus('');};
  const features=async(assetId:string)=>audioJobs.run<Features>('features',{samples:mono(await transport.asset(assetId)),sampleRate:11025,hop:.12});
  const analyze=async()=>{if(!track||!project.score)return;try{
    setBusy(t('分析音频中的音高与节奏…','Analyzing pitch and timing…'));
    const audio=await features(track.sourceAssetId),demo=available.find(t=>t.role==='demo'&&t.id!==id&&t.alignment?.status==='accepted');
    const result=demo?await audioJobs.run<Alignment>('align-demo',{score:project.score,demo:await features(demo.sourceAssetId),demoMap:demo.alignment!.anchors,features:audio}):await audioJobs.run<Alignment>('align',{score:project.score,features:audio});
    setCandidate(result);setStatus(t('自动匹配已完成。试听并校正后，再确认。','Candidate ready. Listen and adjust anchors before accepting.'));
  }catch(e){onError(String(e));}finally{setBusy('');}};
  const manual=()=>{if(!project.score)return;setCandidate({anchors:tempoMap(project.score),method:'manual',status:'candidate',warnings:[]});setStatus(t('以乐谱速度建立对齐点，可以编辑起点和终点。','Anchors use the score tempo. Edit the start and end times.'));};
  const anchors=candidate?.anchors||[];
  const addAnchor=()=>{try{const a={q:Number(q),seconds:Number(seconds)},copy=anchors.filter(v=>Math.abs(v.q-a.q)>.00001).concat(a).sort((a,b)=>a.q-b.q);validateAnchors(copy);setCandidate({...candidate!,anchors:copy,method:'manual',status:'candidate'});}catch(e){onError(String(e));}};
  const accept=async(asReference:boolean)=>{if(!candidate||!track)return;try{
    validateAnchors(candidate.anchors);const p=editProject(project,'accept alignment',p=>{const tr=p.tracks.find(t=>t.id===id)!;tr.alignment={...candidate,status:'accepted'};
      if(asReference){p.scoreMap=candidate.anchors.map(a=>({q:a.q,seconds:a.seconds+tr.offset}));p.referenceTrackId=id;}
    });
    await onCommit(p);setCandidate(p.tracks.find(t=>t.id===id)!.alignment);setStatus(asReference?t('已用此音轨定位谱面。其他音轨可继续对齐到它。','Score now follows this track. Other tracks can be aligned to it.'):t('已确认此音轨的对齐点。','Track alignment accepted.'));
  }catch(e){onError(String(e));}};
  const conform=async()=>{if(!candidate||!track||!project.score)return;try{
    validateAnchors(candidate.anchors);setBusy(t('保调校正音轨时间…','Conforming track timing…'));
    const pcm=await transport.asset(track.sourceAssetId),duration=Math.max(projectDuration(project),qToSeconds(project.score.totalQ,project.scoreMap));
    const rendered=await audioJobs.run<PCM>('conform',{pcm,sourceMap:candidate.anchors,targetMap:project.scoreMap,duration});
    const asset=audioAsset(project,rendered,`${track.name} — aligned.wav`);
    const p=editProject(project,'align',p=>{const tr=p.tracks.find(t=>t.id===id)!;tr.offset=0;tr.clips=[{id:uid(),assetId:asset.id,label:track.name,start:0,end:duration,sourceStart:0,rate:1,gain:1,fadeIn:.005,fadeOut:.005}];tr.alignment={...candidate,status:'accepted'};});
    p.assetIds.push(asset.id);await onCommit(p,[asset]);transport.pcm.set(asset.id,rendered);setStatus(t('音轨已校正到项目时间线。原始素材保留，可撤销。','Track conformed to the project timeline. Original audio is preserved; undo is available.'));
  }catch(e){onError(String(e));}finally{setBusy('');}};
  const preview=async()=>{if(!candidate||!track||!project.score)return;try{setBusy(t('准备试听…','Preparing audition…'));const p=clone(project);p.tracks=p.tracks.map(tr=>({...tr,mute:tr.id!==id,solo:false,offset:0,clips:tr.id===id?[{id:'audition',assetId:track.sourceAssetId,label:tr.name,start:0,end:(transport.pcm.get(track.sourceAssetId)?.channels[0].length||0)/(transport.pcm.get(track.sourceAssetId)?.sampleRate||1),sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0}]:tr.clips}));p.scoreMap=candidate.anchors;p.loop=false;transport.reference=true;await transport.start(p,Math.max(0,Number(seconds)));setStatus(t('正在试听所选原音轨＋谱面合成音。关闭窗口停止。','Auditioning the selected recording with score synth. Close to stop.'));}catch(e){onError(String(e));}finally{setBusy('');}};
  return <Modal title={t('乐谱与音频对齐','Score & audio alignment')} onClose={()=>{if(!busy){transport.pause();transport.reference=false;onClose();}}} wide>
    <div className="alignment-top"><label className="field">{t('音轨','Track')}<select value={id} onChange={e=>choose(e.target.value)}>{available.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button disabled={!!busy||!track||!project.score} onClick={analyze}>{t('自动匹配','Analyze audio')}</button><button disabled={!!busy||!project.score} onClick={manual}>{t('按谱速手动设置','Set anchors manually')}</button></div>
    <p className="muted">{t('先将示范与乐谱匹配并确认，再匹配伴奏，通常更容易找到共同的音乐内容。基准决定谱面在项目时间轴上的位置。','Accept a demonstration track first to help match the backing. The reference defines the score position on the project timeline.')}</p>
    <div className="status-line">{busy||status||t('选择一条音轨开始。','Choose a track to begin.')}</div>
    {candidate&&<>
      <div className="alignment-summary"><span className={`badge ${candidate.status==='accepted'?'success':''}`}>{candidate.status==='accepted'?t('已确认','Accepted'):t('待确认','Candidate')}</span><span>{t('编辑：','Editing: ')}{track?.name}</span><span>{anchors.length} {t('个对齐点','anchors')}</span><span>{t('当前基准：','Reference: ')}{project.tracks.find(t=>t.id===project.referenceTrackId)?.name||t('乐谱速度','Score tempo')}</span></div>
      {candidate.warnings.map(w=><p className="warning" key={w}>{w}</p>)}
      <div className="anchor-add"><label>{t('音乐拍位（四分音符）','Quarter-note position')}<input type="number" min="0" step=".25" value={q} onChange={e=>setQ(e.target.value)}/></label><label>{t('原始音频秒数','Original audio seconds')}<input type="number" step=".01" value={seconds} onChange={e=>setSeconds(e.target.value)}/></label><button disabled={!!busy} onClick={addAnchor}>{t('添加／更新点','Add / update anchor')}</button><button disabled={!!busy} onClick={preview}>{t('试听此处','Audition here')}</button></div>
      <div className="anchor-table"><table><thead><tr><th>{t('小节.拍／四分音符位置','Bar.beat / quarter position')}</th><th>{t('原音频时间（秒）','Original audio (seconds)')}</th><th/></tr></thead><tbody>{anchors.map((a,i)=><tr key={i} className={Math.abs(Number(q)-a.q)<1e-7?'anchor-selected':''}><td><button className="anchor-position" aria-label={`${t('选择对齐点','Select anchor')} ${i+1}`} onClick={()=>{setQ(String(a.q));setSeconds(String(a.seconds));}}>{project.score?scorePositionLabel(a.q,project.score,locale):'—'}</button><small className="anchor-quarter">q = {a.q.toFixed(2)}</small></td><td><input aria-label={`${t('对齐点','Anchor')} ${i+1}`} type="number" step=".01" value={Number(a.seconds.toFixed(3))} onChange={e=>setCandidate({...candidate,anchors:anchors.map((v,j)=>i===j?{...v,seconds:Number(e.target.value)}:v),status:'candidate',method:'manual'})}/></td><td><button disabled={anchors.length<=2} aria-label={t('删除对齐点','Remove anchor')} onClick={()=>setCandidate({...candidate,anchors:anchors.filter((_,j)=>i!==j),status:'candidate',method:'manual'})}>×</button></td></tr>)}</tbody></table></div>
      <footer className="wrap"><button disabled={!!busy} onClick={()=>accept(false)}>{t('保存本轨对齐点','Save track anchors')}</button><button disabled={!!busy||track?.clips.some(c=>c.assetId!==track.sourceAssetId||c.rate!==1)} title={t('基准轨需保持原始时间；已校正音轨可先撤销校正。','Reference tracks must retain original timing. Undo conforming before choosing this track.')} onClick={()=>accept(true)}>{t('设为谱面基准','Set score reference')}</button><button className="primary" disabled={!!busy||project.referenceTrackId===id} onClick={conform}>{t('按基准校正本轨','Conform this track')}</button></footer>
      <p className="muted compact">{t('保存对齐点：只保存本轨对应关系。设为基准：谱面跟随此轨。校正本轨：调整本轨播放时间，可撤销；其他轨不动。','Save anchors stores this track’s mapping. Set reference makes the score follow this track. Conform changes this track’s playback timing and can be undone; other tracks stay in place.')}</p>
    </>}
  </Modal>;
}

export function ExportDialog({project,locale,onClose,onError}:Common&{project:Project}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const [busy,setBusy]=useState(''),[range,setRange]=useState(false),[selected,setSelected]=useState(()=>audibleTrackIds(project.tracks)),[speed,setSpeed]=useState(1);
  const [bitDepth,setBitDepth]=useState<24|32>(24),[ceiling,setCeiling]=useState(-1),[matchLoudness,setMatchLoudness]=useState(false),[target,setTarget]=useState(-18);
  const [analysis,setAnalysis]=useState<{key:string;stats:AudioStats}|null>(null),cache=useRef<{key:string;pcm:PCM;stats:AudioStats}|null>(null);
  const audible=new Set(audibleTrackIds(project.tracks)),solo=project.tracks.some(track=>track.solo);
  const a=range&&project.selection?project.selection.start:0,b=range&&project.selection?project.selection.end:projectDuration(project);
  const key=JSON.stringify([project.revision,selected,a,b,speed]),stats=analysis?.key===key?analysis.stats:null;
  const settings={gainDb:project.masterGainDb??0,ceilingDb:ceiling,targetLufs:matchLoudness?target:undefined},plan=stats?planMaster(stats,settings):null;
  const safe=(s:string)=>s.replace(/[\\/:*?"<>|]/g,'_').slice(0,100),db=(value:number)=>value>0?amplitudeDb(value).toFixed(1):'−∞';
  const getMix=async()=>{
    if(cache.current?.key===key)return cache.current;
    const tracks=project.tracks.filter(track=>selected.includes(track.id));if(!tracks.length)throw Error(t('至少选择一条音轨','Choose at least one track'));
    const rendered:PCM[]=[];
    for(const track of tracks){setBusy(track.name);rendered.push(await renderExport(project,track,a,b,true,speed));}
    setBusy(t('分析响度与真峰值…','Analyzing loudness and true peak…'));
    const pcm=mixTracks(rendered),stats=await audioJobs.run<AudioStats>('measure-export',{pcm});
    const result={key,pcm,stats};cache.current=result;setAnalysis({key,stats});return result;
  };
  const analyze=async()=>{try{setBusy(t('准备分析…','Preparing analysis…'));await getMix();}catch(error){onError(String(error));}finally{setBusy('');}};
  const perform=async(kind:'stems'|'mix'|'project')=>{try{setBusy(t('正在准备导出…','Preparing export…'));
    if(kind==='project'){download(await exportProject(project),`${safe(project.name)}.drippingproj`);return;}
    const tracks=project.tracks.filter(track=>selected.includes(track.id));if(!tracks.length)throw Error(t('至少选择一条音轨','Choose at least one track'));
    if(kind==='mix'){
      const {pcm,stats}=await getMix();setBusy(t('生成高品质 WAV…','Encoding WAV…'));
      const result=await audioJobs.run<{wav:ArrayBuffer;plan:MasterPlan}>('master-wav',{pcm,stats,settings,bitDepth});
      download(new Blob([result.wav],{type:'audio/wav'}),`${safe(project.name)} — mix.wav`);
    }else{
      const files:Record<string,Uint8Array>={};
      for(let i=0;i<tracks.length;i++){setBusy(tracks[i].name);const pcm=await renderExport(project,tracks[i],a,b,false,speed);files[`${String(i+1).padStart(2,'0')} ${safe(tracks[i].name)}.wav`]=new Uint8Array(encodeWav(pcm,32));}
      files['session.json']=strToU8(JSON.stringify({project:project.name,range:{start:a,end:b},sampleRate:48000,bitDepth:32,format:'IEEE float WAV',speed,masterGainDb:project.masterGainDb??0,alignment:'All files share the same zero and length',tracks:tracks.map(track=>({name:track.name,role:track.role,volume:track.volume,pan:track.pan}))},null,2));
      const data=await new Promise<Uint8Array>((resolve,reject)=>zip(files,{level:0},(error,out)=>error?reject(error):resolve(out)));download(new Blob([data as Uint8Array<ArrayBuffer>],{type:'application/zip'}),`${safe(project.name)} — stems.zip`);
    }
  }catch(error){onError(String(error));}finally{setBusy('');}};
  return <Modal title={t('带走你的练习','Export your practice')} onClose={()=>{if(!busy)onClose();}}>
    <p className="muted">{t('混音默认 48 kHz／24-bit WAV；分轨为 48 kHz／32-bit float WAV，共同起点和长度。','Mixes default to 48 kHz / 24-bit WAV. Stems use 48 kHz / 32-bit float WAV with a shared start and length.')}</p>
    <button className="export-reset" disabled={!!busy} onClick={()=>setSelected(audibleTrackIds(project.tracks))}>{t('按当前播放音轨选择','Select currently audible tracks')}</button>
    <div className="check-list">{project.tracks.map(track=><label key={track.id}><input type="checkbox" disabled={!!busy} checked={selected.includes(track.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,track.id]:ids.filter(id=>id!==track.id))}/><span>{track.name}<small className="export-track-state">{!track.clips.length?t('无片段','No clips'):track.mute?t('已静音','Muted'):solo&&!track.solo?t('被其他轨独奏排除','Excluded by solo'):track.solo?t('独奏','Solo'):t('播放','Audible')}{selected.includes(track.id)&&!audible.has(track.id)?t(' · 已手动加入导出',' · explicitly included'):''}</small></span></label>)}</div>
    <label className="field">{t('导出速度','Export speed')}<select disabled={!!busy} aria-label={t('导出速度','Export speed')} value={speed} onChange={event=>setSpeed(Number(event.target.value))}><option value="1">{t('原速 · 100%','Original · 100%')}</option>{project.speed!==1&&<option value={project.speed}>{t('当前练习速度','Current practice speed')} · {Math.round(project.speed*100)}%</option>}</select></label>
    <label className="check"><input type="checkbox" checked={range} disabled={!project.selection||!!busy} onChange={event=>setRange(event.target.checked)}/>{t('只导出选区','Export selection only')} · {formatTime(a)}–{formatTime(b)}</label>
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
    <footer className="wrap"><button disabled={!!busy||!selected.length} onClick={()=>perform('stems')}>{t('分轨 WAV','WAV stems')}</button><button disabled={!!busy||!selected.length} onClick={()=>perform('mix')}>{t('混音 WAV','Mix WAV')}</button><button className="primary" disabled={!!busy} onClick={()=>perform('project')}>{t('完整项目备份','Project backup')}</button></footer><p className="busy-text">{busy}</p>
    {!!project.takes.length&&<details><summary>{t('每次录音的原始干声','Original dry takes')} ({project.takes.length})</summary>{project.takes.map(take=><div className="take-row" key={take.id}><span>{take.name} · {take.speed}× · {take.sampleRate/1000} kHz · {take.channels} ch · {take.interrupted?t('已恢复','Recovered'):formatTime((take.end-take.start)/take.speed)}</span><button onClick={async()=>{try{download(await originalTake(take.assetId),`${safe(take.name)} — dry.wav`);}catch(error){onError(String(error));}}}>{t('下载原声','Download dry')}</button></div>)}</details>}
  </Modal>;
}
