import 'fake-indexeddb/auto';
import {expect,it,vi} from 'vitest';
import {Transport} from '../src/lib/transport';
import {newProject} from '../src/lib/storage';
import type {Track} from '../src/lib/types';

it('toggles cues independently without stopping playback or unmuting the recording target',()=>{
  const transport=new Transport(),project=newProject('Live recording mix');
  project.tracks=['backing','recording'].map(id=>({id,volume:.8,pan:0,mute:false,solo:false,clips:[{}]} as Track));
  const gains=(transport as unknown as {gains:Map<string,GainNode>}).gains;
  for(const id of ['backing','recording','reference','metronome'])gains.set(id,{gain:{setTargetAtTime:vi.fn()}} as unknown as GainNode);
  const context=vi.spyOn(transport,'ctx','get').mockReturnValue({currentTime:12} as AudioContext),pause=vi.spyOn(transport,'pause');
  transport.playing=true;
  const value=(id:string)=>vi.mocked(gains.get(id)!.gain.setTargetAtTime).mock.lastCall![0];
  try{
    for(const [reference,metronome] of [[false,false],[true,false],[true,true],[false,true],[false,false]]){
      transport.reference=reference;transport.metronome=metronome;transport.updateMix(project,'recording');
      expect(value('reference')).toBe(reference?.65:0);expect(value('metronome')).toBe(metronome?.6:0);
      expect(value('backing')).toBe(.8);expect(value('recording')).toBe(0);expect(transport.playing).toBe(true);expect(pause).not.toHaveBeenCalled();
    }
    expect(project.tracks.every(track=>!track.mute)).toBe(true);
  }finally{context.mockRestore();pause.mockRestore();}
});
