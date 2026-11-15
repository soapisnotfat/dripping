// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {probeInput} from '../src/lib/input';

afterEach(()=>vi.unstubAllGlobals());

function mockInput(channelCount:number){
  const stop=vi.fn();
  const track={label:'Test USB interface',getSettings:()=>({sampleRate:44100,channelCount}),stop};
  const getUserMedia=vi.fn().mockResolvedValue({getAudioTracks:()=>[track],getTracks:()=>[track]});
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
  return {stop,getUserMedia};
}

it('reports the opened input and releases it after a connection check',async()=>{
  const {stop}=mockInput(2);
  await expect(probeInput('usb-interface',[0,1])).resolves.toEqual({name:'Test USB interface',sampleRate:44100,channels:2});
  expect(stop).toHaveBeenCalledOnce();
});

it('rejects an unavailable right channel and still releases the microphone',async()=>{
  const {stop}=mockInput(1);
  await expect(probeInput('usb-interface',[1])).rejects.toThrow('Selected input channel unavailable');
  expect(stop).toHaveBeenCalledOnce();
});
