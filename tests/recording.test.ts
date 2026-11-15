// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {it,expect,vi} from 'vitest';
import {Blob} from 'node:buffer';
import {newProject,createSession,saveChunk,getAsset,deleteProject} from '../src/lib/storage';
import {newRecordingSession,finishTake} from '../src/lib/project';
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
