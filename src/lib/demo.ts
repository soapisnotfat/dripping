import type {PCM} from './types';
import {parseScore,soundingEvents} from './score';
import {tempoMap,qToSeconds} from './time';
import {encodeWav} from './audio';

// Original exercise composed for this application; no personal or licensed media.
const melody=[
  ['E4','G4','A4','G4'],['D4','E4','G4','E4'],['C4','E4','G4','B4'],['A4','G4','E4','D4'],
  [],[],['F4','A4','C5','A4'],['E4','G4','B4','G4'],['D4','F4'],['E4','G4','A4','B4'],
  ['C5','B4','A4','G4'],['F4','E4','D4','C4'],['E4','G4','A4','G4'],['D4','E4','G4','B4'],['C5','G4','E4','D4'],['C4']
];
export function demoXml():string {
  return `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>Morning Drops</work-title></work><identification><creator type="composer">Dripping · original exercise</creator></identification><part-list><score-part id="P1"><part-name>Melody</part-name><part-abbreviation>Mel.</part-abbreviation><score-instrument id="I1"><instrument-name>Flute</instrument-name></score-instrument><midi-instrument id="I1"><midi-channel>1</midi-channel><midi-program>74</midi-program></midi-instrument></score-part></part-list><part id="P1">${melody.map((notes,i)=>`<measure number="${i+1}">${i===0?'<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>96</per-minute></metronome></direction-type><sound tempo="96"/></direction>':''}${i===8||i===9?`<attributes><time><beats>${i===8?2:4}</beats><beat-type>4</beat-type></time></attributes>`:''}${i===4?'<attributes><measure-style><multiple-rest>2</multiple-rest></measure-style></attributes>':''}${!notes.length?'<note><rest measure="yes"/><duration>16</duration><type>whole</type></note>':notes.map(p=>`<note><pitch><step>${p[0]}</step><octave>${p[1]}</octave></pitch><duration>${i===15?16:4}</duration><type>${i===15?'whole':'quarter'}</type></note>`).join('')}${i===15?'<barline location="right"><bar-style>light-heavy</bar-style></barline>':''}</measure>`).join('')}</part></score-partwise>`;
}
function addTone(out:Float32Array,sr:number,midi:number,start:number,duration:number,gain:number,kind:'flute'|'piano'){
  const freq=440*2**((midi-69)/12),a=Math.round(start*sr),n=Math.round(duration*sr);
  for(let i=0;i<n&&a+i<out.length;i++){
    const t=i/sr,edge=Math.min(1,t/.015,(duration-t)/.04),env=kind==='piano'?Math.exp(-t*3):.8+.2*Math.exp(-t*5);
    const wave=Math.sin(2*Math.PI*freq*t)+.18*Math.sin(4*Math.PI*freq*t)+.06*Math.sin(6*Math.PI*freq*t);
    if(a+i>=0)out[a+i]+=wave*gain*Math.max(0,edge)*env;
  }
}
export function demoPCM():{backing:PCM;demo:PCM}{
  const score=parseScore(demoXml()),map=tempoMap(score),sr=22050,duration=qToSeconds(score.totalQ,map)+1.5;
  const backing=new Float32Array(Math.ceil(duration*sr)),demo=new Float32Array(Math.ceil(duration*sr));
  const chords=[[48,52,55],[45,48,52],[53,57,60],[43,47,50]];
  for(const m of score.route){
    for(const pitch of chords[m.measure%4]){const start=qToSeconds(m.q,map);addTone(backing,sr,pitch,start+.2,m.duration*.625,.055,'piano');addTone(demo,sr,pitch,start+.55,m.duration*.625,.04,'piano');}
    for(let q=m.q;q<m.q+m.duration;q++){
      const start=qToSeconds(q,map);addTone(backing,sr,q===m.q?36:43,start+.2,.13,.035,'piano');addTone(demo,sr,q===m.q?36:43,start+.55,.13,.025,'piano');
    }
  }
  for(const e of soundingEvents(score))addTone(demo,sr,e.midi!,qToSeconds(e.q,map)+.55,e.duration*.625*.92,.18,'flute');
  return {backing:{sampleRate:sr,channels:[backing]},demo:{sampleRate:sr,channels:[demo]}};
}
export function demoFiles():File[]{
  const audio=demoPCM();return [new File([demoXml()],'Morning Drops.musicxml',{type:'application/vnd.recordare.musicxml+xml'}),new File([encodeWav(audio.backing)],'Morning Drops — Backing.wav',{type:'audio/wav'}),new File([encodeWav(audio.demo)],'Morning Drops — Demo.wav',{type:'audio/wav'})];
}
