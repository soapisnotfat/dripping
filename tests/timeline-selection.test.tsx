// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {Timeline} from '../src/components/Timeline';
import {TrimHandles} from '../src/components/TrimHandles';
import {newProject} from '../src/lib/storage';
import {editSelection,trimRegion} from '../src/lib/project';
import {clipSelection} from '../src/lib/timeline';
import {parseScore} from '../src/lib/score';
import {tempoMap} from '../src/lib/time';
import type {Clip,Selection,Track} from '../src/lib/types';

const clip=(id:string,start:number,end:number):Clip=>({id,assetId:id,label:id,start,end,sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0});
const track=(clips:Clip[],offset=0):Track=>({id:'recording',name:'Recording',role:'recording',clips,offset,volume:1,pan:0,mute:false,solo:false,color:2});
let root:Root;
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
const pointer=(lane:HTMLElement,type:string,seconds:number)=>act(()=>lane.dispatchEvent(new MouseEvent(type,{bubbles:true,button:0,clientX:seconds*100})));
function render(clips:Clip[],offset=0,selection:Selection|null=null,locked=false){
  const project=newProject('Regions'),onSelect=vi.fn(),onSeek=vi.fn();project.score=parseScore(`<score-partwise><part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list><part id="P1">${Array.from({length:10},(_,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction>':''}<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type></note></measure>`).join('')}</part></score-partwise>`);project.scoreMap=tempoMap(project.score);project.tracks=[track(clips,offset)];project.selection=selection;
  act(()=>root.render(<Timeline project={project} locale="en" position={0} scale={100} snap follow={false} waveforms={new Map()} recording={locked} playing={false} counting={false} locked={locked} activeRecording={null} onArm={()=>{}} onSeek={onSeek} onSelect={onSelect} onTrack={()=>{}} onTrim={()=>{}} onContext={()=>{}} onFollow={()=>{}} onTrackSettings={()=>{}}/>));
  const lane=document.querySelector<HTMLElement>('.track-lane')!;
  lane.setPointerCapture=vi.fn();lane.hasPointerCapture=()=>false;
  vi.spyOn(lane,'getBoundingClientRect').mockReturnValue({left:0} as DOMRect);
  return {lane,onSelect,onSeek,project};
}
it('selects an uncut backing as a whole, then each of five separate regions independently',()=>{
  let result=render([clip('Backing',0,20)]);pointer(result.lane,'pointerdown',12);pointer(result.lane,'pointerup',12);
  expect(result.onSelect).toHaveBeenLastCalledWith({start:0,end:20,trackId:'recording',clipId:'Backing'});expect(result.onSeek).not.toHaveBeenCalled();
  const pieces=Array.from({length:5},(_,i)=>clip(`Part ${i+1}`,i*4,(i+1)*4));result=render(pieces);
  pieces.forEach(piece=>{pointer(result.lane,'pointerdown',piece.start+1);pointer(result.lane,'pointerup',piece.start+1);expect(result.onSelect).toHaveBeenLastCalledWith(clipSelection(result.project.tracks[0],piece));});
});
it('keeps forward and reverse drag ranges inside the original region, with track offsets and snapping',()=>{
  const result=render([clip('Take 1',1.03,4.03),clip('Take 2',4.03,6)],.5);
  pointer(result.lane,'pointerdown',2);pointer(result.lane,'pointermove',5.8);pointer(result.lane,'pointerup',5.8);
  expect(result.onSelect).toHaveBeenLastCalledWith({start:2,end:4.53,trackId:'recording',clipId:'Take 1'});
  pointer(result.lane,'pointerdown',3);pointer(result.lane,'pointermove',0);pointer(result.lane,'pointerup',0);
  expect(result.onSelect).toHaveBeenLastCalledWith({start:1.53,end:3,trackId:'recording',clipId:'Take 1'});
});
it('supports keyboard region selection and ignores recording-time edits',()=>{
  const take=clip('Take 2',4,8);let result=render([take]);
  act(()=>document.querySelector('[data-clip-id]')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
  expect(result.onSelect).toHaveBeenLastCalledWith({start:4,end:8,trackId:'recording',clipId:'Take 2'});
  result=render([take],0,null,true);pointer(result.lane,'pointerdown',5);pointer(result.lane,'pointermove',7);pointer(result.lane,'pointerup',7);expect(result.onSelect).not.toHaveBeenCalled();
});
it.each(['split','clear','trim','fade'] as const)('%s edits only the selected region and retains its neighbor',action=>{
  const first=clip('Take 1',1,5),second=clip('Take 2',5,9),project=newProject('Edit');project.tracks=[track([first,second],.5)];
  project.selection={start:2.5,end:4.5,trackId:'recording',clipId:first.id};
  const edited=editSelection(project,action,'recording');
  expect(edited.tracks[0].clips.find(clip=>clip.id===second.id)).toEqual(second);
  expect(project.tracks[0].clips).toEqual([first,second]);expect(edited.undo.at(-1)!.before.selection).toEqual(project.selection);
  if(action==='clear')expect(edited.selection).toBeNull();
  else expect(edited.tracks[0].clips.find(clip=>clip.id===edited.selection?.clipId)).toMatchObject({start:2,end:4,sourceStart:1});
});
it('rejects an out-of-region edit before changing another region',()=>{
  const project=newProject('Boundaries');project.tracks=[track([clip('Take 1',1,5),clip('Take 2',5,9)])];
  project.selection={start:2,end:7,trackId:'recording',clipId:'Take 1'};
  expect(()=>editSelection(project,'clear','recording')).toThrow('within this region');
});

it('trims and restores source audio with offsets/rate while preserving neighbors and undo state',()=>{
  const first={...clip('Take 1',2,6),sourceStart:2,rate:2},second=clip('Take 2',8,10),project=newProject('Edge trim');project.tracks=[track([first,second],.5)];project.selection=clipSelection(project.tracks[0],first);
  const edited=trimRegion(project,'recording',first.id,3.5,5.5,14);
  expect(edited.tracks[0].clips[0]).toMatchObject({id:first.id,start:3,end:5,sourceStart:4,rate:2});expect(edited.tracks[0].clips[1]).toEqual(second);
  expect(edited.undo.at(-1)!.before.tracks).toEqual(project.tracks);expect(edited.selection).toMatchObject({start:3.5,end:5.5,clipId:first.id});
  const restored=trimRegion(edited,'recording',first.id,2.5,6.5,14);expect(restored.tracks[0].clips[0]).toMatchObject({start:2,end:6,sourceStart:2});
  expect(()=>trimRegion(edited,'recording',first.id,3.5,9,14)).toThrow('neighboring regions');
  expect(()=>trimRegion(edited,'recording',first.id,0,5.5,14)).toThrow('neighboring regions');
});

it('previews an edge drag, commits once on release, and cancels without an edit',()=>{
  const project=newProject('Handles'),region={...clip('Take 1',2,6),sourceStart:2,rate:2},target=track([region],.5),onPreview=vi.fn(),onTrim=vi.fn();
  act(()=>root.render(<TrimHandles project={project} track={target} clip={region} sourceDuration={14} scale={100} snap={false} locale="en" onPreview={onPreview} onTrim={onTrim}/>));
  const handle=document.querySelector<HTMLElement>('.trim-start')!;handle.setPointerCapture=vi.fn();handle.hasPointerCapture=()=>false;
  pointer(handle,'pointerdown',2.5);pointer(handle,'pointermove',3.5);
  expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({start:3,end:6,sourceStart:4}));expect(onTrim).not.toHaveBeenCalled();
  pointer(handle,'pointerup',3.5);expect(onTrim).toHaveBeenCalledExactlyOnceWith(3.5,6.5);
  onTrim.mockClear();pointer(handle,'pointerdown',2.5);pointer(handle,'pointermove',3.5);pointer(handle,'pointercancel',3.5);pointer(handle,'pointerup',3.5);
  expect(onTrim).not.toHaveBeenCalled();expect(onPreview).toHaveBeenLastCalledWith(null);
});
