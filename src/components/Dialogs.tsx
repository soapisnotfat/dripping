import {useEffect,useRef,useState,type ReactNode} from 'react';
import {zip,strToU8} from 'fflate';
import type {Project,Locale,Asset,Anchor,Alignment,PCM} from '../lib/types';
import {clone,uid} from '../lib/types';
import {addFiles,guessRole,type ImportItem,audioAsset,editProject,renderExport,originalTake} from '../lib/project';
import {newProject,importProject,exportProject,download} from '../lib/storage';
import {transport} from '../lib/transport';
import {audioJobs} from '../lib/jobs';
import type {Features} from '../lib/alignment';
import {mono,encodeWav,mixTracks} from '../lib/audio';
import {tempoMap,validateAnchors,qToSeconds,projectDuration,formatTime} from '../lib/time';

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
    <div className="import-list">{items.map((item,i)=><div key={i}><span title={item.file.name}>{item.file.name}<small>{(item.file.size/1024/1024).toFixed(1)} MB</small></span>{! /\.drippingproj$/i.test(item.file.name)&&<select aria-label={`${item.file.name} role`} value={item.role} onChange={e=>setItems(rows=>rows.map((r,j)=>i===j?{...r,role:e.target.value as ImportItem['role']}:r))}><option value="score">{t('乐谱','Score')}</option><option value="backing">{t('伴奏','Backing')}</option><option value="demo">{t('示范','Demo')}</option></select>}<button className="icon-button" aria-label={t('移除','Remove')} onClick={()=>setItems(rows=>rows.filter((_,j)=>i!==j))}>×</button></div>)}</div>
    <p className="muted">{t('素材保存在当前浏览器。也可以选择 .drippingproj 恢复完整项目。','Files stay in this browser. Open a .drippingproj file to restore a project.')}</p>
    <footer><span className="busy-text">{busy}</span><button className="primary" disabled={!!busy||(!items.length&&!!project)} onClick={submit}>{busy?t('正在导入…','Importing…'):t('开始练习','Start practicing')}</button></footer>
  </Modal>;
}

export function AlignmentDialog({project,locale,onClose,onError,onCommit,initialTrack}:Common&{project:Project;onCommit:(p:Project,assets?:Asset[])=>Promise<void>;initialTrack?:string}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const available=project.tracks.filter(t=>t.role!=='recording');
  const [id,setId]=useState(initialTrack||available.find(t=>t.role==='demo')?.id||available[0]?.id||'');
  const track=project.tracks.find(t=>t.id===id),[candidate,setCandidate]=useState<Alignment|undefined>(track?.alignment),[busy,setBusy]=useState(''),[status,setStatus]=useState('');
  const [q,setQ]=useState('0'),[seconds,setSeconds]=useState('0');
  const choose=(trackId:string)=>{setId(trackId);setCandidate(project.tracks.find(t=>t.id===trackId)?.alignment);setStatus('');};
  const features=async(assetId:string)=>audioJobs.run<Features>('features',{samples:mono(await transport.asset(assetId)),sampleRate:11025,hop:.12});
  const analyze=async()=>{if(!track||!project.score)return;try{
    setBusy(t('分析音频中的音高与节奏…','Analyzing pitch and timing…'));
    const audio=await features(track.sourceAssetId),demo=project.tracks.find(t=>t.role==='demo'&&t.id!==id&&t.alignment?.status==='accepted');
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
  const preview=async()=>{if(!candidate||!track||!project.score)return;try{setBusy(t('准备试听…','Preparing audition…'));const p=clone(project);p.tracks=p.tracks.map(tr=>({...tr,mute:tr.id!==id,solo:false,offset:0,clips:tr.id===id?[{id:'audition',assetId:tr.sourceAssetId,label:tr.name,start:0,end:(transport.pcm.get(tr.sourceAssetId)?.channels[0].length||0)/(transport.pcm.get(tr.sourceAssetId)?.sampleRate||1),sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0}]:tr.clips}));p.scoreMap=candidate.anchors;p.loop=false;transport.reference=true;await transport.start(p,Math.max(0,Number(seconds)));setStatus(t('正在试听原音轨＋乐谱音。关闭窗口停止。','Auditioning original audio with score tones. Close to stop.'));}catch(e){onError(String(e));}finally{setBusy('');}};
  return <Modal title={t('乐谱与音频对齐','Score & audio alignment')} onClose={()=>{if(!busy){transport.pause();transport.reference=false;onClose();}}} wide>
    <div className="alignment-top"><label className="field">{t('音轨','Track')}<select value={id} onChange={e=>choose(e.target.value)}>{available.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><button disabled={!!busy||!track||!project.score} onClick={analyze}>{t('自动匹配','Analyze audio')}</button><button disabled={!!busy||!project.score} onClick={manual}>{t('按谱速手动设置','Set anchors manually')}</button></div>
    <p className="muted">{t('先将示范与乐谱匹配并确认，再匹配伴奏，通常更容易找到共同的音乐内容。基准决定谱面在项目时间轴上的位置。','Accept a demonstration track first to help match the backing. The reference defines the score position on the project timeline.')}</p>
    <div className="status-line">{busy||status||t('选择一条音轨开始。','Choose a track to begin.')}</div>
    {candidate&&<>
      <div className="alignment-summary"><span className={`badge ${candidate.status==='accepted'?'success':''}`}>{candidate.status==='accepted'?t('已确认','Accepted'):t('待确认','Candidate')}</span><span>{anchors.length} {t('个对齐点','anchors')}</span><span>{t('当前基准：','Reference: ')}{project.tracks.find(t=>t.id===project.referenceTrackId)?.name||t('乐谱速度','Score tempo')}</span></div>
      {candidate.warnings.map(w=><p className="warning" key={w}>{w}</p>)}
      <div className="anchor-add"><label>{t('音乐拍位（四分音符）','Quarter-note position')}<input type="number" min="0" step=".25" value={q} onChange={e=>setQ(e.target.value)}/></label><label>{t('原始音频秒数','Original audio seconds')}<input type="number" step=".01" value={seconds} onChange={e=>setSeconds(e.target.value)}/></label><button disabled={!!busy} onClick={addAnchor}>{t('添加／更新点','Add / update anchor')}</button><button disabled={!!busy} onClick={preview}>{t('试听此处','Audition here')}</button></div>
      <div className="anchor-table"><table><thead><tr><th>{t('音乐拍位','Quarter position')}</th><th>{t('原音频时间（秒）','Original audio (seconds)')}</th><th/></tr></thead><tbody>{anchors.map((a,i)=><tr key={i}><td>{a.q.toFixed(2)}</td><td><input aria-label={`${t('对齐点','Anchor')} ${i+1}`} type="number" step=".01" value={Number(a.seconds.toFixed(3))} onChange={e=>setCandidate({...candidate,anchors:anchors.map((v,j)=>i===j?{...v,seconds:Number(e.target.value)}:v),status:'candidate',method:'manual'})}/></td><td><button disabled={anchors.length<=2} aria-label={t('删除对齐点','Remove anchor')} onClick={()=>setCandidate({...candidate,anchors:anchors.filter((_,j)=>i!==j),status:'candidate',method:'manual'})}>×</button></td></tr>)}</tbody></table></div>
      <footer className="wrap"><button disabled={!!busy} onClick={()=>accept(false)}>{t('确认对齐点','Accept anchors')}</button><button disabled={!!busy||track?.clips.some(c=>c.assetId!==track.sourceAssetId||c.rate!==1)} title={t('基准轨需保持原始时间；已校正音轨可先撤销校正。','Reference tracks must retain original timing. Undo conforming before choosing this track.')} onClick={()=>accept(true)}>{t('用此轨作为基准','Use as reference')}</button><button className="primary" disabled={!!busy||project.referenceTrackId===id} onClick={conform}>{t('将此轨校正到基准','Conform to reference')}</button></footer>
      <p className="muted compact">{t('校正会重建此轨的可播放片段；已有编辑可撤销。改变基准后，其他音轨不会自动重建。','Conforming rebuilds this track’s playable clips and can be undone. Changing the reference does not rebuild other tracks automatically.')}</p>
    </>}
  </Modal>;
}

export function ExportDialog({project,locale,onClose,onError}:Common&{project:Project}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const [busy,setBusy]=useState(''),[range,setRange]=useState(false),[selected,setSelected]=useState(project.tracks.map(t=>t.id)),[normalize,setNormalize]=useState(true);
  const a=range&&project.selection?project.selection.start:0,b=range&&project.selection?project.selection.end:projectDuration(project);
  const safe=(s:string)=>s.replace(/[\\/:*?"<>|]/g,'_').slice(0,100);
  const perform=async(kind:'stems'|'mix'|'project')=>{try{setBusy(t('正在准备导出…','Preparing export…'));
    if(kind==='project'){download(await exportProject(project),`${safe(project.name)}.drippingproj`);return;}
    const tracks=project.tracks.filter(t=>selected.includes(t.id));if(!tracks.length)throw Error(t('至少选择一条音轨','Choose at least one track'));
    const rendered:PCM[]=[],files:Record<string,Uint8Array>={};
    for(let i=0;i<tracks.length;i++){setBusy(tracks[i].name);const pcm=await renderExport(project,tracks[i],a,b,kind==='mix');if(kind==='mix')rendered.push(pcm);else files[`${String(i+1).padStart(2,'0')} ${safe(tracks[i].name)}.wav`]=new Uint8Array(encodeWav(pcm,32));}
    if(kind==='mix'){
      const pcm=mixTracks(rendered);let peak=0;for(const ch of pcm.channels)for(const v of ch)peak=Math.max(peak,Math.abs(v));if(normalize&&peak>.97)for(const ch of pcm.channels)for(let i=0;i<ch.length;i++)ch[i]*=.97/peak;
      download(new Blob([encodeWav(pcm,normalize?16:32)],{type:'audio/wav'}),`${safe(project.name)} — mix.wav`);
    }else{
      files['session.json']=strToU8(JSON.stringify({project:project.name,range:{start:a,end:b},sampleRate:48000,bitDepth:32,format:'IEEE float WAV',speed:1,alignment:'All files share the same zero and length',tracks:tracks.map(t=>({name:t.name,role:t.role,volume:t.volume,pan:t.pan}))},null,2));
      const data=await new Promise<Uint8Array>((resolve,reject)=>zip(files,{level:0},(e,out)=>e?reject(e):resolve(out)));download(new Blob([data as Uint8Array<ArrayBuffer>],{type:'application/zip'}),`${safe(project.name)} — stems.zip`);
    }
  }catch(e){onError(String(e));}finally{setBusy('');}};
  return <Modal title={t('带走你的练习','Export your practice')} onClose={()=>{if(!busy)onClose();}}>
    <p className="muted">{t('分轨统一为 48 kHz／32-bit float WAV，共同起点和长度，可直接放入 Logic Pro 或 GarageBand。导出使用项目原速。','Stems use 48 kHz / 32-bit float WAV with a shared start and length. Import directly into Logic Pro or GarageBand. Exports use the original project tempo.')}</p>
    <div className="check-list">{project.tracks.map(track=><label key={track.id}><input type="checkbox" checked={selected.includes(track.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,track.id]:ids.filter(id=>id!==track.id))}/><span>{track.name}</span></label>)}</div>
    <label className="check"><input type="checkbox" checked={range} disabled={!project.selection} onChange={e=>setRange(e.target.checked)}/>{t('只导出选区','Export selection only')} · {formatTime(a)}–{formatTime(b)}</label>
    <label className="check"><input type="checkbox" checked={normalize} onChange={e=>setNormalize(e.target.checked)}/>{t('混音超出峰值时降低增益','Reduce mix gain if peaks exceed headroom')}</label>
    <p className="muted compact">{t('导出以上勾选音轨。分轨保留片段编辑但不套用推子／声像；混音使用推子和声像。','Exports use the tracks checked above. Stems keep edits without mixer levels or pan; mixes include mixer levels and pan.')}</p>
    <footer className="wrap"><button disabled={!!busy||!selected.length} onClick={()=>perform('stems')}>{t('分轨 WAV','WAV stems')}</button><button disabled={!!busy||!selected.length} onClick={()=>perform('mix')}>{t('混音 WAV','Mix WAV')}</button><button className="primary" disabled={!!busy} onClick={()=>perform('project')}>{t('完整项目备份','Project backup')}</button></footer><p className="busy-text">{busy}</p>
    {!!project.takes.length&&<details><summary>{t('每次录音的原始干声','Original dry takes')} ({project.takes.length})</summary>{project.takes.map(take=><div className="take-row" key={take.id}><span>{take.name} · {take.speed}× · {take.interrupted?t('已恢复','Recovered'):formatTime((take.end-take.start)/take.speed)}</span><button onClick={async()=>{try{download(await originalTake(take.assetId),`${safe(take.name)} — dry.wav`);}catch(e){onError(String(e));}}}>{t('下载原声','Download dry')}</button></div>)}</details>}
  </Modal>;
}
