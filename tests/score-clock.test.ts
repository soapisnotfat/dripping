// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {Blob} from 'node:buffer';
import {parseScore,setOpeningTempo} from '../src/lib/score';
import {newProject,getProject,getAsset,saveProject,exportProject,importProject} from '../src/lib/storage';
import {scoreTempoProject} from '../src/lib/score-time';
import {clipSourceTime} from '../src/lib/clip-time';
import {clipTrimBounds} from '../src/lib/timeline';
import {trimRegion} from '../src/lib/project';
import {tempoMap,qToSeconds,projectDuration} from '../src/lib/time';
import {renderTrack,splitClips,encodeWav} from '../src/lib/audio';
import type {Track} from '../src/lib/types';
vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',Blob);

const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><rest measure="yes"/><duration>4</duration></note></measure><measure number="2"><attributes><time><beats>3</beats><beat-type>8</beat-type></time></attributes><direction><sound tempo="60"/></direction><note><rest measure="yes"/><duration>1.5</duration></note></measure></part></score-partwise>`;
function legacy(){
  const p=newProject('Legacy');p.scoreXml=xml;p.score=parseScore(xml);p.scoreMap=[{q:0,seconds:1},{q:4,seconds:5},{q:5.5,seconds:5.75}];p.referenceTrackId='backing';p.position=5.5;
  p.tracks=[{id:'backing',name:'Backing',sourceAssetId:'raw',role:'backing',offset:0,volume:1,pan:0,mute:false,solo:false,color:0,clips:[{id:'region',assetId:'raw',label:'Backing',start:1,end:5.75,sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0}]}];
  p.assetIds=['raw'];p.selection={trackId:'backing',clipId:'region',start:3,end:5.5};p.loop=true;
  const state={tracks:structuredClone(p.tracks),selection:structuredClone(p.selection),scoreMap:structuredClone(p.scoreMap),referenceTrackId:p.referenceTrackId};p.undo=[{label:'old reference edit',before:structuredClone(state),after:structuredClone(state)}];
  return p;
}
it('moves legacy arrangement, selection, playhead and undo onto the score clock without rewriting sources',()=>{
  const old=legacy(),original=structuredClone(old),p=scoreTempoProject(old),clip=p.tracks[0].clips[0];
  expect(p.scoreMap).toEqual(tempoMap(p.score!));expect(p.referenceTrackId).toBeUndefined();expect(projectDuration(p)).toBe(3.5);expect(p.position).toBeCloseTo(3);
  expect(clip).toMatchObject({id:'region',assetId:'raw',start:0,end:3.5});expect(p.tracks[0].clips).toHaveLength(1);
  expect(clipSourceTime(clip,qToSeconds(4,p.scoreMap))).toBeCloseTo(4);expect(clipSourceTime(clip,3)).toBeCloseTo(4.5);
  expect(p.selection).toMatchObject({start:1,end:3});expect(p.undo[0].before.scoreMap).toEqual(p.scoreMap);expect(p.undo[0].before.referenceTrackId).toBeUndefined();
  expect(p.assetIds).toEqual(old.assetIds);expect(old).toEqual(original);expect(scoreTempoProject(p)).toBe(p);
});
it('normalizes stale undo clocks even when the current project clock is already correct',()=>{
  const p=legacy();p.tracks=[];p.scoreMap=tempoMap(p.score!);p.referenceTrackId=undefined;
  const next=scoreTempoProject(p);expect(next.undo[0].before.referenceTrackId).toBeUndefined();expect(next.undo[0].before.tracks[0].clips[0]).toMatchObject({start:0,end:3.5});
});
it('preserves source coordinates through splitting a non-linear migrated region',()=>{
  const p=scoreTempoProject(legacy()),clip=p.tracks[0].clips[0],split=splitClips([clip],1,2.5);
  expect(split).toHaveLength(3);expect(split[1].sourceStart).toBeCloseTo(2);expect(split[2].sourceStart).toBeCloseTo(4.25);
  expect(clipSourceTime(split[2],3)).toBeCloseTo(4.5);
});
it('allows a beat trim when browser decoding rounds the source one sample shorter',()=>{
  const p=scoreTempoProject(legacy()),track=p.tracks[0],duration=4.75-1/44100;
  expect(clipTrimBounds(track,track.clips[0],duration).end).toBe(3.5);
  expect(trimRegion(p,track.id,track.clips[0].id,.5,3.5,duration).tracks[0].clips[0].start).toBe(.5);
});
it('renders the migrated stereo region to score duration while preserving pitch on both tempo segments',()=>{
  const p=scoreTempoProject(legacy()),rate=12000,source={sampleRate:rate,channels:[440,660].map(freq=>Float32Array.from({length:rate*5},(_,i)=>.15*Math.sin(2*Math.PI*freq*i/rate)))},out=renderTrack(p.tracks[0],new Map([['raw',source]]),0,3.5,rate);
  const frequency=(data:Float32Array,from:number,to:number)=>{const crossings:number[]=[];for(let i=Math.round(from*rate)+1;i<to*rate;i++)if(data[i-1]<0&&data[i]>=0)crossings.push(i-data[i]/(data[i]-data[i-1]));return (crossings.length-1)*rate/(crossings.at(-1)!-crossings[0]);};
  expect(out.channels.map(channel=>channel.length)).toEqual([42000,42000]);
  for(const [channel,pitch] of [[0,440],[1,660]])for(const [a,b] of [[.3,1.7],[2.3,3.2]])expect(frequency(out.channels[channel],a,b)).toBeCloseTo(pitch,0);
});
it('loads and persists existing projects on the score clock',async()=>{
  const p=legacy();await saveProject(p);const loaded=await getProject(p.id);expect(loaded!.referenceTrackId).toBeUndefined();expect(loaded!.tracks[0].clips[0].end).toBe(3.5);expect((await getProject(p.id))!.scoreMap).toEqual(tempoMap(loaded!.score!));
});
it('requires confirmation of missing opening tempo and preserves later written changes',()=>{
  const missing=xml.replace('<direction><sound tempo="120"/></direction>','<direction><direction-type><words>Andante</words></direction-type></direction>'),score=parseScore(missing);expect(score.tempoMissing).toBe(true);
  const changed=setOpeningTempo(missing,100);expect(changed).toContain('Andante');const fixed=parseScore(changed);expect(fixed.tempoMissing).toBe(false);expect(fixed.tempo).toEqual([{q:0,bpm:100},{q:4,bpm:60}]);
  expect(()=>setOpeningTempo(missing,0)).toThrow();
  const midBar=missing.replace('<note>','<direction><offset>2</offset><sound tempo="90"/></direction><note>');
  expect(parseScore(setOpeningTempo(midBar,100)).tempo).toEqual([{q:0,bpm:100},{q:2,bpm:90},{q:4,bpm:60}]);
});
it.each([.1,8])('round-trips a migrated %s source rate and untouched original take bytes',async rate=>{
  const p=legacy();p.undo=[];p.redo=[];p.scoreXml=setOpeningTempo(xml,60);p.score=parseScore(p.scoreXml);p.scoreMap=[{q:0,seconds:0},{q:5.5,seconds:5.5*rate}];
  p.tracks[0].clips[0]={...p.tracks[0].clips[0],start:0,end:5.5*rate};
  const id=crypto.randomUUID();p.assetIds=[id];p.tracks[0].sourceAssetId=id;p.tracks[0].clips[0].assetId=id;
  const pcm={sampleRate:4000,channels:[new Float32Array(Math.round(5.5*rate*4000))]},blob=new Blob([encodeWav(pcm,32)]) as unknown as globalThis.Blob;
  p.takes=[{id:'take',name:'Original',assetId:id,trackId:'backing',start:0,end:5.5*rate,speed:1,sampleRate:4000,channels:1,createdAt:p.createdAt,inputLabel:'Test',latencyMs:0,interrupted:false}];
  const normalized=scoreTempoProject(p);expect(normalized.tracks[0].clips[0].rate).toBeCloseTo(rate);expect(normalized.takes).toEqual(p.takes);
  await saveProject(normalized,[{id,projectId:p.id,name:'source.wav',type:'audio/wav',blob}]);const restored=await importProject(await exportProject(normalized));
  expect(restored.tracks[0].clips[0].rate).toBeCloseTo(rate);expect(restored.takes[0]).toMatchObject({start:0,end:5.5*rate,speed:1});
  expect(await(await getAsset(restored.assetIds[0])).blob.arrayBuffer()).toEqual(await blob.arrayBuffer());
});
