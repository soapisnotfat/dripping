// Developer-only page. The production entrypoint does not import this module.
import {createRoot} from 'react-dom/client';
import App from '../src/App';
import {transport} from '../src/lib/transport';
import '../src/styles.css';
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
  await transport.ctx.resume();const input=transport.ctx.createOscillator(),gain=transport.ctx.createGain(),stream=transport.ctx.createMediaStreamDestination();
  input.frequency.value=440;gain.gain.value=.1;input.connect(gain).connect(stream);input.start();
  const track=stream.stream.getAudioTracks()[0],stop=track.stop.bind(track);track.stop=()=>{input.stop();input.disconnect();gain.disconnect();stop();};
  return stream.stream;
}});
createRoot(document.querySelector('#root')!).render(<App/>);
