// Developer-only page. The production entrypoint does not import this module.
import {createRoot} from 'react-dom/client';
import App from '../src/App';
import {transport} from '../src/lib/transport';
import '../src/styles.css';
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
  await transport.ctx.resume();const input=transport.ctx.createOscillator(),gain=transport.ctx.createGain(),stream=transport.ctx.createMediaStreamDestination();
  input.frequency.value=440;const requestedPeak=Number(new URLSearchParams(location.search).get('peak')??.1);gain.gain.value=Number.isFinite(requestedPeak)?Math.max(0,Math.min(1.2,requestedPeak)):.1;input.connect(gain).connect(stream);input.start();
  const track=stream.stream.getAudioTracks()[0],stop=track.stop.bind(track);track.stop=()=>{input.stop();input.disconnect();gain.disconnect();stop();};
  return stream.stream;
}});
createRoot(document.querySelector('#root')!).render(<App/>);

// Inspect the live Web Audio gains while operating the real recording controls.
const status=document.createElement('output');status.id='recording-test-status';status.style.cssText='display:block;font:11px monospace;padding:12px;white-space:pre-wrap';document.body.append(status);
setInterval(()=>{
  const gains=(transport as unknown as {gains:Map<string,GainNode>}).gains;
  status.textContent=JSON.stringify({playing:transport.playing,position:transport.position(),gains:Object.fromEntries([...gains].map(([id,node])=>[id,node.gain.value]))});
},100);
