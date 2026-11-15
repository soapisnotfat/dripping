// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {Blob} from 'node:buffer';
import {describe,it,expect,vi} from 'vitest';
import {newProject,saveProject,getProject,getAsset,exportProject,importProject,createSession,saveChunk,readSession,deleteSession,recoverySessions} from '../src/lib/storage';
import type {Asset,RecordingSession} from '../src/lib/types';
vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',Blob);

describe('local persistence and recovery',()=>{
  it('exports and restores all assets without overwriting the original project',async()=>{
    const p=newProject('Round trip');const a:Asset={id:crypto.randomUUID(),projectId:p.id,name:'test.wav',type:'audio/wav',blob:new Blob([new Uint8Array([1,2,3,4])]) as unknown as globalThis.Blob};p.assetIds=[a.id];
    p.tracks=[{id:'track',name:'Backing',role:'backing',sourceAssetId:a.id,clips:[{id:'clip',assetId:a.id,label:'Audio',start:.37,end:2.37,sourceStart:1,rate:1,gain:1,fadeIn:0,fadeOut:0}],volume:.7,pan:-.2,mute:false,solo:false,offset:0,color:0}];
    await saveProject(p,[a]);const archive=await exportProject(p),restored=await importProject(archive);
    expect(restored.id).not.toBe(p.id);expect(restored.tracks[0].clips[0]).toMatchObject({start:.37,end:2.37,sourceStart:1});
    expect(await(await getAsset(restored.assetIds[0])).blob.arrayBuffer()).toEqual(await a.blob.arrayBuffer());
    expect((await getProject(p.id))?.name).toBe('Round trip');
  });
  it('recovers only committed sequential PCM chunks after an interrupted take',async()=>{
    const s:RecordingSession={id:crypto.randomUUID(),projectId:'p',trackId:'t',name:'Interrupted',start:3,speed:.75,sampleRate:48000,channels:1,createdAt:new Date().toISOString(),inputLabel:'test',latencyMs:0,chunks:0,frames:0};
    await createSession(s);await saveChunk(s.id,0,[new Float32Array([.1,.2])]);await saveChunk(s.id,1,[new Float32Array([.3])]);
    const result=await readSession(s.id);expect(result.channels[0]).toEqual(new Float32Array([.1,.2,.3]));expect(result.session.frames).toBe(3);
    expect((await recoverySessions()).some(v=>v.id===s.id)).toBe(true);await deleteSession(s.id);expect((await recoverySessions()).some(v=>v.id===s.id)).toBe(false);
  });
});
