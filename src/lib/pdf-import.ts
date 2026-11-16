import pin from '../../vendor/sheetscan/pin.json';
import {parseScore} from './score';
import type {ScoreConversion} from './types';
export type ConversionProgress={phase:string;page?:number;text?:string;done?:number;total?:number};
type Converted={musicxml:string;recognizerVersion:string;bridge:string;audit:unknown;rasters:{png:ArrayBuffer;width:number;height:number}[]};
type Converter={convert:(files:File[],options:{signal:AbortSignal})=>Promise<Converted>;close:()=>void};
type SDK={createScoreConverter:(options:{onProgress:(event:ConversionProgress)=>void})=>Converter};
export type PreparedScore={originals:File[];musicxml:File;audit:Blob;provenance:Omit<ScoreConversion,'originalAssetIds'|'musicxmlAssetId'|'auditAssetId'>};
const digest=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function convertPdf(files:File[],signal:AbortSignal,onProgress:(event:ConversionProgress)=>void):Promise<PreparedScore>{
  signal.throwIfAborted();
  const url=new URL(`${import.meta.env.BASE_URL}vendor/sheetscan/${pin.version}/sheetscan.js`,document.baseURI).href;
  const sdk=await import(/* @vite-ignore */ url) as SDK;signal.throwIfAborted();
  const converter=sdk.createScoreConverter({onProgress});
  try{
    const result=await converter.convert(files,{signal});signal.throwIfAborted();
    // Recognition cannot touch the project until the same MusicXML parser used
    // by playback accepts the complete result.
    parseScore(result.musicxml);
    const musicxml=new File([result.musicxml],files[0].name.replace(/\.pdf$/i,'')+'.musicxml',{type:'application/vnd.recordare.musicxml+xml'});
    const provenance={version:1 as const,engine:'sheetscan' as const,modelVersion:pin.version,recognizerVersion:result.recognizerVersion,sourceCommit:pin.sourceCommit,bridge:result.bridge,createdAt:new Date().toISOString()};
    const audit=new Blob([JSON.stringify({provenance,source:pin.source,models:pin.models.map(({name,sha256})=>({name,sha256})),inputs:await Promise.all(files.map(async file=>({name:file.name,sha256:await digest(file)}))),musicxmlSha256:await digest(musicxml),pages:await Promise.all(result.rasters.map(async raster=>({width:raster.width,height:raster.height,sha256:await digest(new Blob([raster.png]))}))),recognition:result.audit})],{type:'application/json'});
    signal.throwIfAborted();return {originals:files,musicxml,audit,provenance};
  }finally{converter.close();}
}
