// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {it,expect,vi} from 'vitest';
import {Blob} from 'node:buffer';
import {newProject,createSession,saveChunk,getAsset,deleteProject,saveProject,exportProject,importProject} from '../src/lib/storage';
import {newRecordingSession,finishTake,addRecordingTrack} from '../src/lib/project';
vi.stubGlobal('Blob',Blob);

it('compensates latency at project zero without trimming the original take, and finalizes once',async()=>{
  let p=newProject('Latency test');
  const session=newRecordingSession(p,'recording',0,48000,1,'Synthetic',50);session.speed=.75;
  await createSession(session);await saveChunk(session.id,0,[new Float32Array(48000).fill(.2)]);
  p=await finishTake(p,session.id);
  const clip=p.tracks[0].clips[0];
  expect(clip.start).toBe(0);expect(clip.sourceStart).toBeCloseTo(.05);expect(clip.end).toBeCloseTo(.7125);
  expect((await getAsset(p.takes[0].assetId)).blob.size).toBe(44+48000*4);
  const same=await finishTake(p,session.id);expect(same.assetIds).toEqual(p.assetIds);expect(same.takes).toHaveLength(1);
  await deleteProject(p.id);
});

it('records into the chosen pre-existing track and preserves other tracks and original takes',async()=>{
  let p=addRecordingTrack(newProject('Explicit target'),'First');p=addRecordingTrack(p,'Second');
  const first=p.tracks[0].id,second=p.tracks[1].id;
  await saveProject(p);
  const record=async(start:number)=>{
    const session=newRecordingSession(p,second,start,48000,1,'Synthetic',0);
    await createSession(session);await saveChunk(session.id,0,[new Float32Array(48000).fill(.1)]);
    p=await finishTake(p,session.id);
  };
  await record(3);
  expect(p.tracks.map(t=>t.id)).toEqual([first,second]);expect(p.tracks[0].clips).toHaveLength(0);
  expect(p.tracks[1].clips[0]).toMatchObject({start:3,end:4});
  expect(p.tracks[1].sourceAssetId).toBe(p.takes[0].assetId);
  const original=await(await getAsset(p.takes[0].assetId)).blob.arrayBuffer();
  await record(3.25);
  expect(p.tracks).toHaveLength(2);expect(p.takes).toHaveLength(2);
  expect(p.takes.every(t=>t.trackId===second)).toBe(true);
  expect(await(await getAsset(p.takes[0].assetId)).blob.arrayBuffer()).toEqual(original);
  const restored=await importProject(await exportProject(p));
  expect(restored.tracks[0].sourceAssetId).toBeUndefined();expect(restored.tracks[0].clips).toHaveLength(0);
  expect(restored.tracks[1].clips).toHaveLength(p.tracks[1].clips.length);
  expect(restored.undo.at(-1)?.before.tracks[1].clips).toHaveLength(1);
  await deleteProject(p.id);await deleteProject(restored.id);
});
it('backs up and restores an empty recording track before its first take',async()=>{
  const p=addRecordingTrack(newProject('Empty track'),'My instrument');await saveProject(p);
  const restored=await importProject(await exportProject(p));
  expect(restored.assetIds).toHaveLength(0);
  expect(restored.tracks[0]).toMatchObject({name:'My instrument',role:'recording',clips:[]});
  expect(restored.tracks[0].sourceAssetId).toBeUndefined();
  await deleteProject(p.id);await deleteProject(restored.id);
});
