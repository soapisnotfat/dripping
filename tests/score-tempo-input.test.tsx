// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ScoreTempo} from '../src/components/ScoreTempo';

let root:Root;
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());document.body.replaceChildren();vi.useRealTimers();vi.unstubAllGlobals();});
const input=()=>document.querySelector('input')!;
const fill=(value:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input(),value);input().dispatchEvent(new Event('input',{bubbles:true}));});

it('debounces valid tempo, retains focus and accepts incomplete input without changing music',()=>{
  const onTempo=vi.fn();act(()=>root.render(<ScoreTempo bpm={120} missing={false} disabled={false} locale="en" onTempo={onTempo}/>));
  act(()=>input().focus());const node=input();fill('1');act(()=>vi.advanceTimersByTime(400));fill('12');act(()=>vi.advanceTimersByTime(400));fill('');act(()=>vi.advanceTimersByTime(400));expect(onTempo).not.toHaveBeenCalled();
  fill('96');act(()=>vi.advanceTimersByTime(349));expect(onTempo).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(1));expect(onTempo).toHaveBeenLastCalledWith(96);
  act(()=>root.render(<ScoreTempo bpm={96} missing={false} disabled={false} locale="en" onTempo={onTempo}/>));expect(input()).toBe(node);expect(document.activeElement).toBe(node);expect(input().value).toBe('96');expect(document.querySelector('button')).toBeNull();
});

it('commits valid missing tempo on blur immediately and cancels a pending change when recording locks input',()=>{
  const onTempo=vi.fn();act(()=>root.render(<ScoreTempo bpm={120} missing disabled={false} locale="en" onTempo={onTempo}/>));expect(input().value).toBe('');
  act(()=>input().focus());fill('100');act(()=>input().blur());expect(onTempo).toHaveBeenCalledExactlyOnceWith(100);act(()=>vi.advanceTimersByTime(500));expect(onTempo).toHaveBeenCalledTimes(1);
  fill('80');act(()=>root.render(<ScoreTempo bpm={100} missing={false} disabled locale="en" onTempo={onTempo}/>));act(()=>vi.advanceTimersByTime(500));expect(onTempo).toHaveBeenCalledTimes(1);expect(input().disabled).toBe(true);
});
