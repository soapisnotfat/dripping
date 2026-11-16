import {useEffect,useRef,useState,useMemo} from 'react';
import {OpenSheetMusicDisplay,type VexFlowGraphicalNote} from 'opensheetmusicdisplay';
import type {Project,Locale,ScoreEvent,Selection} from '../lib/types';
import {secondsToQ,qToSeconds} from '../lib/time';
import {scoreEngraving} from '../lib/score-display';

export type CursorMode='note'|'beat'|'bar'|'continuous'|'off';
type NoteBox={id:string;measure:number;x:number;y:number;width:number;height:number};
type Props={project:Project;position:number;locale:Locale;zoom:number;follow:boolean;onFollow:(value:boolean)=>void;
  mode:CursorMode;onSeek:(seconds:number)=>void;onSelect:(selection:Selection|null)=>void;onContext:(x:number,y:number)=>void;onError:(error:string)=>void};

export function ScoreView({project,position,locale,zoom,follow,onFollow,mode,onSeek,onSelect,onContext,onError}:Props){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en;
  const viewport=useRef<HTMLDivElement>(null),host=useRef<HTMLDivElement>(null),osmdRef=useRef<OpenSheetMusicDisplay|undefined>(undefined);
  const [boxes,setBoxes]=useState<NoteBox[]>([]),[loading,setLoading]=useState(false),[width,setWidth]=useState(800);
  const programmaticScroll=useRef(0),drag=useRef<{id:string;x:number;y:number;moved:boolean}|null>(null);
  const q=secondsToQ(position,project.scoreMap),score=project.score;
  const engraving=useMemo(()=>scoreEngraving(project),[project.scoreXml,project.scoreConversion?.engine]);
  const current=score?[...score.events].reverse().find(e=>e.q<=q+1e-7&&!e.grace):undefined;
  const boxById=useMemo(()=>new Map(boxes.map(b=>[b.id,b])),[boxes]);
  const activeBox=current?boxById.get(current.id):undefined;
  const selectionQ=project.selection?[secondsToQ(project.selection.start,project.scoreMap),secondsToQ(project.selection.end,project.scoreMap)]:null;
  const selectedIds=useMemo(()=>new Set(score&&selectionQ?score.events.filter(e=>e.q<selectionQ[1]-1e-7&&e.q+Math.max(e.duration,.001)>selectionQ[0]+1e-7).map(e=>e.id):[]),[score,selectionQ?.[0],selectionQ?.[1]]);

  useEffect(()=>{
    const view=viewport.current;if(!view)return;
    let timer:ReturnType<typeof setTimeout>;
    const measure=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(host.current)setWidth(Math.floor(host.current.getBoundingClientRect().width));},100);};
    const resize=new ResizeObserver(measure);resize.observe(view);window.addEventListener('resize',measure);measure();
    return()=>{resize.disconnect();window.removeEventListener('resize',measure);clearTimeout(timer);};
  },[!!score]);
  useEffect(()=>{
    if(!host.current||!project.scoreXml||!score)return;
    let stopped=false;setLoading(true);
    const mount=document.createElement('div');host.current.replaceChildren(mount);
    const osmd=new OpenSheetMusicDisplay(mount,{backend:'svg',autoResize:false,autoBeam:engraving.autoBeam,drawTitle:false,drawSubtitle:false,drawComposer:false,drawPartNames:false,drawPartAbbreviations:false,drawMeasureNumbers:true,followCursor:false,disableCursor:true,pageFormat:'Endless',newSystemFromXML:false,newPageFromXML:false,defaultColorMusic:'#30372f'});
    osmd.EngravingRules.RenderMultipleRestMeasures=false;osmd.EngravingRules.AutoGenerateMultipleRestMeasuresFromRestMeasures=false;osmd.Zoom=zoom;
    osmdRef.current=osmd;
    (async()=>{
      await osmd.load(engraving.xml);if(stopped)return;
      for(const instrument of osmd.Sheet.Instruments)instrument.Visible=instrument.IdString===score.partId;
      osmd.render();
      const instrument=osmd.Sheet.Instruments.find(i=>i.IdString===score.partId),root=host.current!.getBoundingClientRect();
      const results:NoteBox[]=[],used=new Set<string>();
      for(const voice of instrument?.Voices||[])for(const entry of voice.VoiceEntries)for(const note of entry.Notes){
        const measure=note.SourceMeasure.measureListIndex,onset=entry.Timestamp.RealValue*4;
        const pitch=note.isRest()?null:note.Pitch?.getHalfTone()+12;
        const candidates=score.measures[measure]?.notes||[];
        const matching=candidates.find(e=>!used.has(e.id)&&Math.abs(e.onset-onset)<1e-4&&e.writtenMidi===pitch&&e.grace===note.IsGraceNote&&e.voice===String(voice.VoiceId))
          ||candidates.find(e=>!used.has(e.id)&&Math.abs(e.onset-onset)<1e-4&&e.writtenMidi===pitch&&e.grace===note.IsGraceNote);
        if(!matching)continue;
        const graphical=osmd.EngravingRules.GNote(note) as VexFlowGraphicalNote|undefined;
        if(!graphical)continue;
        const head=graphical.getNoteheadSVGs?.()?.[graphical.vfnoteIndex]||graphical.getSVGGElement?.();
        if(!head)continue;
        const rect=head.getBoundingClientRect();if(!rect.width&&!rect.height)continue;
        used.add(matching.id);results.push({id:matching.id,measure,x:rect.left-root.left-6,y:rect.top-root.top-12,width:Math.max(18,rect.width+12),height:Math.max(36,rect.height+24)});
      }
      // Whole-measure rests do not always expose an individual SVG notehead.
      for(const measure of score.measures){
        const rests=measure.notes.filter(n=>n.midi===null&&!used.has(n.id));if(!rests.length)continue;
        const graphical=osmd.GraphicSheet.MeasureList[measure.index]?.find(m=>m?.getSVGGElement?.()?.getBoundingClientRect().width>0);
        const rect=graphical?.getSVGGElement()?.getBoundingClientRect();if(!rect)continue;
        for(const rest of rests){const x=rect.left-root.left+rect.width*(rest.onset+rest.duration*.5)/measure.duration-12;results.push({id:rest.id,measure:measure.index,x,y:rect.top-root.top+rect.height*.4-12,width:24,height:40});}
      }
      if(!stopped){setBoxes(results);setLoading(false);}
    })().catch(e=>{if(!stopped){setLoading(false);onError(String(e));}});
    return()=>{stopped=true;};
  },[engraving,score?.partId,zoom,width]);

  useEffect(()=>{
    if(!follow||!activeBox||!viewport.current||!host.current)return;
    const view=viewport.current,y=activeBox.y+host.current.getBoundingClientRect().top-view.getBoundingClientRect().top+view.scrollTop;
    if(y<view.scrollTop+35||y+activeBox.height>view.scrollTop+view.clientHeight-45){
      programmaticScroll.current=performance.now()+700;view.scrollTo({top:Math.max(0,y-view.clientHeight*.32),behavior:'smooth'});
    }
  },[activeBox?.id,follow]);
  const eventFor=(id:string):ScoreEvent|undefined=>{
    const events=score?.events.filter(e=>e.id===id)||[];
    return events.find(e=>e.occurrence===current?.occurrence)||events.find(e=>e.q>=q-1e-6)||events[0];
  };
  const selectBetween=(first:string,last:string)=>{
    const a=eventFor(first),b=eventFor(last);if(!a||!b)return;
    onSelect({start:qToSeconds(Math.min(a.q,b.q),project.scoreMap),end:qToSeconds(Math.max(a.q+a.duration,b.q+b.duration,Math.min(a.q,b.q)+.125),project.scoreMap)});
  };
  let cursor=activeBox?{...activeBox}:undefined;
  if(cursor&&current&&mode==='bar'){
    const measureBoxes=boxes.filter(b=>b.measure===current.measure);
    const x=Math.min(...measureBoxes.map(b=>b.x)),y=Math.min(...measureBoxes.map(b=>b.y));
    cursor={...cursor,x,y,width:Math.max(...measureBoxes.map(b=>b.x+b.width))-x,height:Math.max(...measureBoxes.map(b=>b.y+b.height))-y};
  }else if(cursor&&current&&(mode==='beat'||mode==='continuous')){
    const origin=score?.route.find(m=>m.id===current.occurrence)?.q||0,step=4/(score?.measures[current.measure]?.beatType||4);
    const targetQ=mode==='beat'?origin+Math.floor((q-origin)/step)*step:q;
    const next=score?.events.find(e=>e.q>current.q&&e.occurrence===current.occurrence&&!e.grace),nextBox=next&&boxById.get(next.id);
    if(nextBox&&Math.abs(nextBox.y-cursor.y)<100)cursor.x+=(nextBox.x-cursor.x)*Math.max(0,Math.min(1,(targetQ-current.q)/(next.q-current.q)));
    cursor.width=3;cursor.y-=10;cursor.height+=20;
  }
  if(!score)return <div className="empty-score"><span className="empty-glyph">𝄞</span><h3>{t('添加 PDF 或 MusicXML','Add a PDF or MusicXML score')}</h3><p>{t('音乐会在这里展开。添加后，练习与录音将跟随谱面的小节、拍与速度。','Your music unfolds here. Add one to practice and record using score bars, beats and tempo.')}</p></div>;
  return <div ref={viewport} className="score-viewport" onWheel={()=>onFollow(false)} onTouchMove={()=>onFollow(false)}>
    <div className="score-paper">
      {loading&&<div className="score-loading">{t('正在排版乐谱…','Engraving your score…')}</div>}
      <div className="score-surface"><div ref={host} className="engraving" />
      <div className="score-overlay" aria-label={t('互动乐谱','Interactive score')}>
        {boxes.map(box=><button key={box.id} data-note-id={box.id} className={`score-hit ${selectedIds.has(box.id)?'selected':''}`} style={{left:box.x,top:box.y,width:box.width,height:box.height}}
          title={`${t('第','Measure')} ${score.measures[box.measure].number} ${t('小节 · 点击定位，拖动选段','· Click to seek, drag to select')}`} aria-label={`${t('第','Measure')} ${score.measures[box.measure].number} ${box.id}`}
          onPointerDown={e=>{if(e.button!==0)return;drag.current={id:box.id,x:e.clientX,y:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerMove={e=>{const d=drag.current;if(!d||Math.hypot(e.clientX-d.x,e.clientY-d.y)<5)return;d.moved=true;const el=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-note-id]');if(el?.dataset.noteId)selectBetween(d.id,el.dataset.noteId);}}
          onPointerUp={e=>{const d=drag.current;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(!d?.moved){const event=eventFor(box.id);if(event){if(e.shiftKey&&project.selection){onSelect({start:Math.min(project.selection.start,qToSeconds(event.q,project.scoreMap)),end:Math.max(project.selection.end,qToSeconds(event.q+Math.max(.125,event.duration),project.scoreMap))});}else onSeek(qToSeconds(event.q,project.scoreMap));}}}}
          onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();const event=eventFor(box.id);if(event)onSeek(qToSeconds(event.q,project.scoreMap));}}}
          onContextMenu={e=>{e.preventDefault();if(!selectedIds.has(box.id))selectBetween(box.id,box.id);onContext(e.clientX,e.clientY);}} />)}
        {cursor&&mode!=='off'&&q>=0&&q<score.totalQ&&<div className={`score-cursor mode-${mode}`} style={{left:cursor.x,top:cursor.y,width:cursor.width,height:cursor.height}} />}
      </div></div>
    </div>
  </div>;
}
