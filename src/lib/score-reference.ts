import type {Project,Score,ScoreEvent,Alignment,Anchor} from './types';
import {parseScore,scorePitchDeclaration} from './score';

export type ScoreReference={score:Score;kind:'score-part'|'score-parts';parts:{id:string;name:string}[];signature:string;pitch:'xml'|'concert'|'unspecified';warnings:string[]};
const signature=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
export const alignmentMapSignature=(anchors:Anchor[])=>signature(anchors.map(anchor=>[anchor.q,anchor.seconds]));
export function alignmentMatchesReference(alignment:Alignment|undefined,reference:ScoreReference){return !!alignment?.reference&&alignment.reference.scoreSignature===reference.signature&&alignment.reference.pitch!=='unspecified'&&reference.pitch!=='unspecified';}
export async function scoreReference(project:Project,accompaniment=false):Promise<ScoreReference>{
  if(!project.scoreXml||!project.score)throw Error('请先添加乐谱 / Add a score first');
  const canonical=project.score,warnings:string[]=[],parts:{id:string;name:string}[]=[],events:ScoreEvent[]=[];
  const selected=canonical.parts.find(part=>part.id===canonical.partId)!;
  const requested=accompaniment?canonical.parts.filter(part=>part.id!==canonical.partId):[selected];
  for(const part of requested){
    const parsed=parseScore(project.scoreXml,part.id);let compatible=true;const mapped:ScoreEvent[]=[];
    for(const occurrence of canonical.route){
      const measure=parsed.measures[occurrence.measure];if(!measure){compatible=false;break;}
      if(measure.notes.some(note=>note.midi!==null&&(note.onset<0||note.onset+note.duration>occurrence.duration+1e-6))){compatible=false;break;}
      for(const note of measure.notes)mapped.push({...note,q:occurrence.q+note.onset,occurrence:occurrence.id});
    }
    if(!compatible){warnings.push(`声部 ${part.name} 与当前演奏顺序不兼容 / Part ${part.name} does not fit the current route`);continue;}
    if(!mapped.some(note=>note.midi!==null&&!note.grace))continue;parts.push(part);events.push(...mapped);
  }
  if(!parts.length&&accompaniment){const fallback=await scoreReference(project,false);return {...fallback,warnings:[...warnings,...fallback.warnings]};}
  if(!parts.length)throw Error('所选声部没有可匹配音符 / The selected part has no pitched notes');
  const score={...canonical,events:events.sort((a,b)=>a.q-b.q)},kind=accompaniment?'score-parts':'score-part';
  const declarations=parts.map(part=>scorePitchDeclaration(project.scoreXml!,part.id)),pitch=declarations.every(value=>value==='concert')?'concert':declarations.every(value=>value!=='unspecified')?'xml':'unspecified';
  // Written tempo only changes playback. Reference identity follows musical
  // content, instrument pitch, voices and the canonical performance route.
  const content={parts:parts.map(part=>part.id),declarations,route:canonical.route.map(bar=>[bar.measure,bar.q,bar.duration,bar.pass]),notes:score.events.map(note=>[note.part,note.measure,note.q,note.duration,note.midi,note.voice,note.staff,note.grace,note.tieStart,note.tieStop])};
  return {score,kind,parts,signature:await signature(content),pitch,warnings};
}
