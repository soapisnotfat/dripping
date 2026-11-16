import pin from '../../vendor/sheetscan/pin.json';
import {parseScore} from './score';
import type {ScoreConversion} from './types';
export type ConversionProgress={phase:string;page?:number;current?:number;pageCount?:number;text?:string;type?:string;done?:number;total?:number;resource?:string;resourceURL?:string;attempt?:number;maxAttempts?:number};
type Converted={musicxml:string;recognizerVersion:string;bridge:string;audit:unknown;rasters:{png:ArrayBuffer;width:number;height:number}[]};
export type PreviewPage={png:ArrayBuffer;width:number;height:number;fileIndex:number;page:number;pageCount:number};
type Converter={convert:(files:File[],options:{signal:AbortSignal})=>Promise<Converted>;close:()=>void};
type SDK={createScoreConverter:(options:{onProgress:(event:ConversionProgress)=>void;modelBase?:string})=>Converter;renderPreview:(files:File[],options:{signal:AbortSignal;maxWidth:number;onPage:(page:PreviewPage)=>void})=>Promise<{pages:PreviewPage[]}>};
let sdkPromise:Promise<SDK>|undefined,failedImports=0;
const sdkURL=()=>new URL(`${import.meta.env.BASE_URL}vendor/sheetscan/${pin.version}/sheetscan.js`,document.baseURI);
async function loadSDK(signal:AbortSignal):Promise<SDK>{
  signal.throwIfAborted();
  if(!sdkPromise){const url=sdkURL();if(failedImports)url.searchParams.set('load-retry',String(failedImports));
    sdkPromise=(import(/* @vite-ignore */ url.href) as Promise<SDK>).catch(error=>{sdkPromise=undefined;failedImports++;const failure=error instanceof Error?error:new Error(String(error));Object.assign(failure,{resourceURL:url.href,code:'SDK_LOAD_FAILED'});throw failure;});}
  let abort=()=>{};const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
  return Promise.race([sdkPromise,cancelled]).finally(()=>signal.removeEventListener('abort',abort));
}
export async function previewPdf(files:File[],signal:AbortSignal,onPage:(page:PreviewPage)=>void){
  const sdk=await loadSDK(signal);signal.throwIfAborted();return sdk.renderPreview(files,{signal,onPage,maxWidth:1400});
}
export type PreparedScore={xml:string;originals:File[];musicxml:File;audit:Blob;provenance:Omit<ScoreConversion,'originalAssetIds'|'musicxmlAssetId'|'auditAssetId'>};
const digest=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function convertPdf(files:File[],signal:AbortSignal,onProgress:(event:ConversionProgress)=>void):Promise<PreparedScore>{
  signal.throwIfAborted();
  const sdk=await loadSDK(signal);signal.throwIfAborted();
  const modelBase='modelBase' in pin&&typeof pin.modelBase==='string'?new URL(pin.modelBase,sdkURL()).href:undefined;
  const converter=sdk.createScoreConverter({onProgress,modelBase});
  try{
    const result=await converter.convert(files,{signal});signal.throwIfAborted();
    // Recognition cannot touch the project until the same MusicXML parser used
    // by playback accepts the complete result.
    parseScore(result.musicxml);
    const musicxml=new File([result.musicxml],files[0].name.replace(/\.pdf$/i,'')+'.musicxml',{type:'application/vnd.recordare.musicxml+xml'});
    const provenance={version:1 as const,engine:'sheetscan' as const,modelVersion:pin.version,recognizerVersion:result.recognizerVersion,sourceCommit:pin.sourceCommit,bridge:result.bridge,createdAt:new Date().toISOString()};
    const audit=new Blob([JSON.stringify({provenance,source:pin.source,models:pin.models.map(({name,sha256})=>({name,sha256})),inputs:await Promise.all(files.map(async file=>({name:file.name,sha256:await digest(file)}))),musicxmlSha256:await digest(musicxml),pages:await Promise.all(result.rasters.map(async raster=>({width:raster.width,height:raster.height,sha256:await digest(new Blob([raster.png]))}))),recognition:result.audit})],{type:'application/json'});
    signal.throwIfAborted();return {xml:result.musicxml,originals:files,musicxml,audit,provenance};
  }finally{converter.close();}
}
