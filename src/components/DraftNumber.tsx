import {useEffect,useId,useRef,useState} from 'react';

export function DraftNumber({value,onCommit,label,invalidText,disabled=false,min,max,step=1}:{value:number;onCommit:(value:number)=>void;label:string;invalidText:string;disabled?:boolean;min?:number;max?:number;step?:number}){
  const [draft,setDraft]=useState(String(value)),[invalid,setInvalid]=useState(false),input=useRef<HTMLInputElement>(null),focused=useRef(false),helpId=useId();
  useEffect(()=>{if(!focused.current){setDraft(String(value));setInvalid(false);}},[value]);
  const commit=()=>{const node=input.current;if(!node||disabled)return;if(!node.value||!node.validity.valid||!Number.isFinite(Number(node.value))){setInvalid(true);return;}setInvalid(false);if(Number(node.value)!==value)onCommit(Number(node.value));};
  return <span className="draft-number"><input ref={input} aria-label={label} type="number" required min={min} max={max} step={step} disabled={disabled} value={draft} aria-invalid={invalid||undefined} aria-describedby={invalid?helpId:undefined} onFocus={()=>{focused.current=true;}} onChange={event=>{setDraft(event.target.value);setInvalid(false);}} onBlur={()=>{focused.current=false;commit();}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();commit();}}}/>{invalid&&<small id={helpId} role="alert">{invalidText}</small>}</span>;
}
