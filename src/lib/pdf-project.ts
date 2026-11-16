import type {Asset,Project} from './types';
import {clone,uid} from './types';
import {getAsset} from './storage';
import {parseScore} from './score';
import {tempoMap} from './time';
import {scoreTempoProject} from './score-time';
import type {PreparedScore} from './pdf-import';
export async function pdfFiles(project:Project):Promise<File[]>{
  const ids=project.pdfSource?.assetIds||project.scoreConversion?.originalAssetIds||[];
  return Promise.all(ids.map(async id=>{const asset=await getAsset(id);if(asset.projectId!==project.id)throw Error('PDF project mismatch');return new File([asset.blob],asset.name,{type:'application/pdf'});}));
}
export function attachPdfScore(project:Project,sourceId:string,result:PreparedScore):{project:Project;assets:Asset[]}|null{
  const source=project.pdfSource;if(!source||source.id!==sourceId||source.state!=='pending'||project.scoreXml)return null;
  const p=clone(project),score=parseScore(result.xml),xmlId=uid(),auditId=uid();p.scoreXml=result.xml;p.score=score;p.scoreMap=tempoMap(score);p.scoreAssetId=xmlId;p.pdfSource={...source,state:'complete',error:undefined};
  p.scoreConversion={...result.provenance,originalAssetIds:[...source.assetIds],musicxmlAssetId:xmlId,auditAssetId:auditId};p.assetIds=[...new Set([...p.assetIds,xmlId,auditId])];
  return {project:scoreTempoProject(p),assets:[{id:xmlId,projectId:p.id,name:result.musicxml.name,type:result.musicxml.type,blob:result.musicxml},{id:auditId,projectId:p.id,name:'score-conversion.json',type:'application/json',blob:result.audit}]};
}
export function pdfFailure(error:unknown):NonNullable<NonNullable<Project['pdfSource']>['error']>{
  const detail=error as {message?:string;code?:string;resourceURL?:string;attempts?:number};return {message:String(detail?.message||error).slice(0,4000),code:typeof detail?.code==='string'?detail.code:undefined,resourceURL:typeof detail?.resourceURL==='string'?detail.resourceURL:undefined,attempts:Number.isInteger(detail?.attempts)?detail.attempts:undefined};
}
