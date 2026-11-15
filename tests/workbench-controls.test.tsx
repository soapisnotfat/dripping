// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import type {Score,Track} from '../src/lib/types';
import {newProject} from '../src/lib/storage';
import {audibleTrackIds} from '../src/lib/mix';
import {scorePositionLabel} from '../src/lib/time';
import {ExportDialog} from '../src/components/Dialogs';
import {SelectionEditor} from '../src/components/SelectionEditor';

let root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());document.body.replaceChildren();vi.unstubAllGlobals();});
const track=(id:string,patch:Partial<Track>={}):Track=>({id,name:id,role:'recording',clips:[{id:'clip',assetId:id,label:id,start:0,end:4,sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0}],volume:1,pan:0,mute:false,solo:false,offset:0,color:0,...patch});
const checkbox=(name:string)=>[...document.querySelectorAll('label')].find(label=>label.textContent?.startsWith(name))!.querySelector('input')!;
const fill=(input:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};

it('uses the same mute/solo rules for export selection and playback',()=>{
  const tracks=[track('backing'),track('demo',{mute:true}),track('take')];
  expect(audibleTrackIds(tracks)).toEqual(['backing','take']);
  tracks[2].solo=true;expect(audibleTrackIds(tracks)).toEqual(['take']);
  tracks[2].mute=true;expect(audibleTrackIds(tracks)).toEqual([]);
});

it('defaults to audible tracks while retaining explicit export overrides',()=>{
  const project=newProject('Export');project.tracks=[track('backing'),track('demo',{mute:true}),track('take')];
  act(()=>root.render(<ExportDialog project={project} locale="en" onClose={()=>{}} onError={()=>{}}/>));
  expect(checkbox('backing').checked).toBe(true);expect(checkbox('demo').checked).toBe(false);expect(checkbox('take').checked).toBe(true);
  act(()=>checkbox('demo').click());expect(checkbox('demo').checked).toBe(true);expect(project.tracks[1].mute).toBe(true);
  expect(document.body.textContent).toContain('explicitly included');
  act(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Select currently audible tracks')!.click());
  expect(checkbox('demo').checked).toBe(false);
});

it('applies an exact range without enabling looping or changing recording targets',()=>{
  const project=newProject('Range');project.tracks=[track('take')];project.selection={start:0,end:4};project.loop=false;
  const onSelect=vi.fn();
  act(()=>root.render(<SelectionEditor project={project} locale="en" trackId="take" disabled={false} onSelect={onSelect}/>));
  const inputs=document.querySelectorAll<HTMLInputElement>('input');
  act(()=>{fill(inputs[0],'1.125');fill(inputs[1],'3.75');});
  act(()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(onSelect).toHaveBeenCalledWith({start:1.125,end:3.75,trackId:'take'});expect(project.loop).toBe(false);
  expect(project.selection).toEqual({start:0,end:4});
});

it('keeps the current range when a typed range is invalid',()=>{
  const project=newProject('Range');project.tracks=[track('take')];project.selection={start:0,end:4};
  const onSelect=vi.fn();
  act(()=>root.render(<SelectionEditor project={project} locale="en" trackId="take" disabled={false} onSelect={onSelect}/>));
  act(()=>fill(document.querySelectorAll<HTMLInputElement>('input')[0],'5'));
  act(()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(onSelect).not.toHaveBeenCalled();expect(document.querySelector('[role=alert]')).not.toBeNull();
});

it('bounds typed ranges to the selected region and can restore the whole region',()=>{
  const project=newProject('Take range');project.tracks=[track('take')];project.tracks[0].offset=.5;
  project.selection={start:1,end:2,trackId:'take',clipId:'clip'};const onSelect=vi.fn();
  act(()=>root.render(<SelectionEditor project={project} locale="en" trackId="take" disabled={false} onSelect={onSelect}/>));
  act(()=>fill(document.querySelectorAll<HTMLInputElement>('input')[1],'5'));
  act(()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(onSelect).not.toHaveBeenCalled();expect(document.querySelector('[role=alert]')!.textContent).toContain('within this region');
  act(()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Select whole region')!.click());
  expect(onSelect).toHaveBeenLastCalledWith({start:.5,end:4.5,trackId:'take',clipId:'clip'});
});

it('creates a typed range without a drag gesture or arming a different recording track',()=>{
  const project=newProject('Range');project.tracks=[track('take')];
  const onSelect=vi.fn();
  act(()=>root.render(<SelectionEditor project={project} locale="en" trackId="take" disabled={false} onSelect={onSelect}/>));
  const inputs=document.querySelectorAll<HTMLInputElement>('input');
  act(()=>{fill(inputs[0],'1');fill(inputs[1],'2.5');});
  act(()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(onSelect).toHaveBeenCalledWith({start:1,end:2.5,trackId:'take'});expect(project.selection).toBeNull();
});

it('refreshes range defaults and track selection when changing projects',()=>{
  const first=newProject('First');first.tracks=[track('old')];
  const next=newProject('Next');next.tracks=[track('new',{clips:[{...track('new').clips[0],end:8}]})];
  const onSelect=vi.fn();
  act(()=>root.render(<SelectionEditor project={first} locale="en" trackId="old" disabled={false} onSelect={onSelect}/>));
  act(()=>fill(document.querySelectorAll<HTMLInputElement>('input')[0],'2'));
  act(()=>root.render(<SelectionEditor project={next} locale="en" trackId="new" disabled={false} onSelect={onSelect}/>));
  expect(Array.from(document.querySelectorAll<HTMLInputElement>('input'),input=>input.value)).toEqual(['0','8']);
  expect(document.querySelector('select')!.value).toBe('new');expect(onSelect).not.toHaveBeenCalled();
});

it('labels variable meters and the exclusive score end without inventing extra beats',()=>{
  const score={totalQ:7.5,measures:[{beatType:4},{beatType:4},{beatType:8}],route:[{number:'1',measure:0,q:0,duration:4,pass:1},{number:'2',measure:1,q:4,duration:2,pass:1},{number:'3',measure:2,q:6,duration:1.5,pass:1}]} as Score;
  expect(scorePositionLabel(5.5,score)).toBe('2.2+0.5');expect(scorePositionLabel(6,score)).toBe('3.1');expect(scorePositionLabel(7,score)).toBe('3.3');expect(scorePositionLabel(7.5,score)).toBe('End');
});
