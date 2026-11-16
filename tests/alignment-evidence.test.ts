// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {audioFeatures,alignToScore,alignToDemo,type Features} from '../src/lib/alignment';
import {assessAlignment,assessDemoBridge} from '../src/lib/alignment-evidence';
import {demoXml,demoPCM} from '../src/lib/demo';
import {parseScore,setNotationInstrument} from '../src/lib/score';
import {mono} from '../src/lib/audio';
import {tempoMap,qToSeconds} from '../src/lib/time';
import type {Alignment} from '../src/lib/types';
const score=parseScore(setNotationInstrument(demoXml(),'P1','concert'));
const audio=demoPCM(),demo=audioFeatures(mono(audio.demo),11025,.12),backing=audioFeatures(mono(audio.backing),11025,.12),demoMap=alignToScore(score,demo);
it('derives note-to-decoded-source-sample audition cues, rejecting melody-free accompaniment',()=>{
 const evidence=assessAlignment(score,demo,demoMap,22050);expect(evidence.decision).toBe('supported');expect(evidence.supportedFraction).toBe(1);expect(evidence.points[0]).toMatchObject({q:0,midi:[64]});expect(evidence.points.every(point=>Number.isInteger(point.sourceSample)&&point.sourceSample>=0&&point.sourceSample<audio.demo.channels[0].length)).toBe(true);
 const wrong=assessAlignment(score,backing,alignToScore(score,backing),22050);expect(wrong.decision).toBe('insufficient');expect(wrong.reasons).toContain('weak-note-attacks');
});
it('uses actual shared accompaniment for a reviewed demo bridge without claiming melody-note matches',()=>{
 const reviewedMap=tempoMap(score).map(point=>({...point,seconds:point.seconds+.55})),candidate:Alignment={anchors:tempoMap(score).map(point=>({...point,seconds:point.seconds+.2})),status:'candidate',method:'chroma-dtw',cost:.1,warnings:[]},evidence=assessDemoBridge(score,demo,reviewedMap,backing,candidate,22050);expect(evidence.basis).toBe('shared-accompaniment');expect(evidence.decision).toBe('supported');expect(evidence.points.every(point=>point.midi.length===0)).toBe(true);
 const silent=audioFeatures(new Float32Array(11025*40),11025,.12);expect(assessDemoBridge(score,demo,demoMap.anchors,silent,candidate,22050).decision).toBe('insufficient');
});
it('does not allow a constant common bass note to verify a demo bridge',()=>{
 const frames=200,hop=.12,values=new Float32Array(frames*12),energy=new Float32Array(frames).fill(.1);for(let i=0;i<frames;i++)values[i*12]=1;const drone:Features={values,bass:values,energy,frames,hop,duration:frames*hop},candidate:Alignment={anchors:[{q:0,seconds:0},{q:score.totalQ,seconds:frames*hop}],status:'candidate',method:'chroma-dtw',warnings:[]};const result=assessDemoBridge(score,drone,candidate.anchors,drone,candidate,11025);expect(result.decision).toBe('insufficient');expect(result.reasons).toContain('low-shared-structure');
});
it('rejects a second indistinguishable eight-note prefix instead of relying on low path cost',()=>{
 // Self-composed exact pitch/attack features isolate duplicate phrase ambiguity.
 const steps=['C','E','G','D','A','F','B','E'],xml=`<score-partwise><part-list><score-part id="P1"><part-name>C</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions><time><beats>8</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="60"/></direction>${steps.map(step=>`<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration></note>`).join('')}</measure></part></score-partwise>`,reference=parseScore(xml),hop=.1,frames=180,values=new Float32Array(frames*12),energy=new Float32Array(frames),pitches=[0,4,7,2,9,5,11,4];
 for(const offset of [0,90])for(let note=0;note<8;note++)for(let frame=offset+note*10+1;frame<offset+note*10+8;frame++){values[frame*12+pitches[note]]=1;energy[frame]=.1;}
 const features:Features={values,energy,frames,hop,duration:18},candidate:Alignment={anchors:[{q:0,seconds:.1},{q:8,seconds:8.1}],status:'candidate',method:'chroma-dtw',cost:.01,warnings:[]},result=assessAlignment(reference,features,candidate,11025);expect(result.supportedFraction).toBe(1);expect(result.decision).toBe('ambiguous');expect(result.reasons).toContain('repeated-prefix-candidates');
});
it('requires explicit score tempo for direct and demo analysis',()=>{
 const missing={...score,tempoMissing:true};expect(()=>alignToScore(missing,demo)).toThrow('score tempo');expect(()=>alignToDemo(missing,demo,tempoMap(score),backing)).toThrow('score tempo');
});
it('keeps evidence tied to musical q through written tempo changes and a trimmed leading rest',()=>{
 const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Alto</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time><transpose><diatonic>-5</diatonic><chromatic>-9</chromatic></transpose></attributes><direction><sound tempo="120"/></direction><note><rest/><duration>2</duration></note><note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration></note><direction><sound tempo="60"/></direction><note><pitch><step>B</step><octave>4</octave></pitch><duration>3</duration></note></measure></part></score-partwise>`,reference=parseScore(xml),map=tempoMap(reference),hop=.025,frames=160,values=new Float32Array(frames*12),energy=new Float32Array(frames),anchors=map.map(point=>({...point,seconds:point.seconds-.4}));
 for(const event of reference.events.filter(event=>event.midi!==null)){const at=Math.floor(qToSeconds(event.q,anchors)/hop);for(let frame=at;frame<at+8;frame++){values[frame*12+event.midi!%12]=1;energy[frame]=.1;}}
 const result=assessAlignment(reference,{values,energy,frames,hop,duration:4},{anchors,status:'candidate',method:'manual',warnings:[]},48000);expect(anchors[0].seconds).toBeLessThan(0);expect(result.points.map(point=>[point.q,point.midi])).toEqual([[1,[65]],[1.5,[62]]]);expect(result.points[0].sourceSample/48000).toBeCloseTo(.0875,4);expect(result.reasons).toContain('too-few-note-attacks');
});
it('fits manual source pairs without retaining contradictory provisional endpoints, including trimmed score rests',async()=>{
 const {pairSourceAnchor}=await import('../src/lib/alignment'),initial=[{q:0,seconds:0},{q:4,seconds:2},{q:6,seconds:4}],one=pairSourceAnchor(6,initial,[],0,0),two=pairSourceAnchor(6,one.anchors,one.manualAnchors,4,4.8);expect(two.manualAnchors).toEqual([0,4]);expect(qToSeconds(4,two.anchors)).toBeCloseTo(4.8);expect(qToSeconds(6,two.anchors)).toBeCloseTo(7.2);
 const first=pairSourceAnchor(6,initial,[],2,0),next=pairSourceAnchor(6,first.anchors,first.manualAnchors,4,1);expect(next.anchors[0]).toEqual({q:0,seconds:-1});expect(()=>pairSourceAnchor(6,next.anchors,next.manualAnchors,5,.5)).toThrow();expect(()=>pairSourceAnchor(6,initial,[],Number.NaN,1)).toThrow();expect(()=>pairSourceAnchor(6,next.anchors,next.manualAnchors,0,-1)).toThrow('inside the source');
});
it('keeps approximate pitch-class evidence finite for valid microtonal MusicXML notes',()=>{
 const microtonal={...score,events:score.events.map(event=>({...event,midi:event.midi===null?null:event.midi+.25}))},assessment=assessAlignment(microtonal,demo,demoMap,22050);expect(assessment.points.length).toBeGreaterThan(0);expect(assessment.points.every(point=>Number.isFinite(point.support)&&Number.isFinite(point.attack))).toBe(true);expect(assessment.points[0].midi).toEqual([64.25]);
});
it('does not approve adjacent notes collapsed into the same coarse source frame even with full pitch support',()=>{
 const base=score.events[0],compressed={...score,totalQ:1,events:Array.from({length:8},(_,index)=>({...base,q:index*.01,duration:.005,midi:64}))},values=new Float32Array(36),energy=new Float32Array([0,.1,0]);values[12+4]=1;const result=assessAlignment(compressed,{values,energy,frames:3,hop:.12,duration:.36},{anchors:[{q:0,seconds:0},{q:1,seconds:.1}],status:'candidate',method:'chroma-dtw',cost:0,warnings:[]},48000);expect(result.supportedFraction).toBe(1);expect(result.decision).not.toBe('supported');expect(result.reasons).toContain('unresolved-note-entries');
});
