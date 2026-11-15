// Developer-only geometry regression; excluded from the production entrypoint.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Timeline} from '../src/components/Timeline';
import {newProject} from '../src/lib/storage';
import {parseScore} from '../src/lib/score';
import {demoXml} from '../src/lib/demo';
import type {Track} from '../src/lib/types';
import '../src/styles.css';

const base=newProject('Timeline geometry');
base.score=parseScore(demoXml());
// Independent fixture: leading silence, tempo changes and the demo's 2/4 measure.
base.scoreMap=[{q:0,seconds:.55},{q:8,seconds:5.35},{q:34,seconds:24.85},{q:62,seconds:43.05}];
base.tracks=(['backing','demo','recording'] as const).map((role,index):Track=>({
  id:role,name:role==='recording'?'Recording 1':`Morning Drops — ${role==='demo'?'Demo':'Backing'}`,
  role,volume:.8,pan:0,mute:role==='demo',solo:false,offset:0,color:index,
  clips:role==='recording'?[]:[{id:role,assetId:role,label:`${role}.wav`,start:0,end:44,sourceStart:0,rate:1,gain:1,fadeIn:0,fadeOut:0}],
}));
const waves=new Map(['backing','demo'].map(id=>[id,{duration:44,peaks:Float32Array.from({length:1200},(_,i)=>Math.abs(Math.sin(i*.13))*.3)}]));
document.documentElement.dataset.theme='dark';

function LayoutChecks(){
  const [project,setProject]=useState(base),[scale,setScale]=useState(42),[scoreMode,setScoreMode]=useState(true),[fontScale,setFontScale]=useState('100%'),[result,setResult]=useState('Ready'),[passed,setPassed]=useState('');
  const check=()=>{
    try{
      const rows=[...document.querySelectorAll<HTMLElement>('.track-row')],ruler=document.querySelector<HTMLElement>('.ruler')!.getBoundingClientRect();
      const header=[...document.querySelectorAll<HTMLElement>('.ruler>span')].map(node=>node.getBoundingClientRect().left-ruler.left);
      const measurements=rows.map(row=>{
        const label=row.querySelector<HTMLElement>('.track-label')!.getBoundingClientRect(),lane=row.querySelector<HTMLElement>('.track-lane')!.getBoundingClientRect();
        const lines=[...row.querySelectorAll<HTMLElement>('.lane-grid>i')].map(node=>node.getBoundingClientRect().left-lane.left);
        if(Math.abs(label.top-lane.top)>.5||Math.abs(label.bottom-lane.bottom)>.5)throw Error(`Row bounds differ: ${JSON.stringify({label:label.height,lane:lane.height})}`);
        if(Math.abs(lane.left-ruler.left)>.5)throw Error('Ruler and track time origins differ');
        const expectedCount=scoreMode?16:9;
        if(lines.length!==expectedCount)throw Error(`Expected ${expectedCount} real grid lines, found ${lines.length}`);
        if(header.some(x=>!lines.some(line=>Math.abs(line-x)<.5)))throw Error('A numbered ruler line does not match the track grid');
        // At 42 px/s, these are 0.55, 2.95 and 5.35 seconds, not fixed 84px divisions.
        if((scoreMode?[.55,2.95,5.35]:[0,5,10]).some((seconds,index)=>Math.abs(lines[index]-seconds*scale)>.5))throw Error('Grid ignores the ruler timing');
        return{track:row.dataset.trackId,height:lane.height,firstLines:lines.slice(0,3),maxHeaderError:Math.max(...header.map(x=>Math.min(...lines.map(line=>Math.abs(line-x)))))};
      });
      setPassed('passed');setResult(JSON.stringify({fontScale,scale,scoreMode,measurements},null,2));
    }catch(error){setPassed('failed');setResult(String(error));}
  };
  return <main style={{padding:10}}>
    <h1 style={{fontSize:18}}>Timeline layout checks</h1>
    <p>Real Timeline component · 4/4 → 2/4 · nonlinear alignment · muted Demo · empty recording track</p>
    <label>Text scale <select aria-label="Text scale" value={fontScale} onChange={e=>{setFontScale(e.target.value);document.documentElement.style.setProperty('-webkit-text-size-adjust',e.target.value);document.documentElement.style.setProperty('text-size-adjust',e.target.value);}}>{['100%','125%','150%','200%'].map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Timeline scale <select aria-label="Timeline scale" value={scale} onChange={e=>setScale(Number(e.target.value))}>{[12,42,84].map(value=><option key={value}>{value}</option>)}</select></label>
    <label>Timing <select aria-label="Timing" value={scoreMode?'score':'audio'} onChange={e=>setScoreMode(e.target.value==='score')}><option value="score">Aligned score</option><option value="audio">Audio only</option></select></label>
    <button id="check" onClick={check}>Check row and bar alignment</button>
    <Timeline project={{...project,score:scoreMode?project.score:undefined}} locale="en" position={0} scale={scale} snap={false} follow={false} waveforms={waves} recording={false} playing={false} counting={false} locked={false} activeRecording={null} onArm={()=>{}} onSeek={()=>{}} onSelect={selection=>setProject({...project,selection})} onTrack={(id,patch)=>setProject({...project,tracks:project.tracks.map(track=>track.id===id?{...track,...patch}:track)})} onTrim={()=>{}} onContext={()=>{}} onFollow={()=>{}} onTrackSettings={()=>{}}/>
    <pre id="results" data-result={passed} style={{whiteSpace:'pre-wrap',fontSize:11}}>{result}</pre>
  </main>;
}
createRoot(document.querySelector('#root')!).render(<LayoutChecks/>);
