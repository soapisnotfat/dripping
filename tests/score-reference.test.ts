// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import {webcrypto} from 'node:crypto';
import {Blob} from 'node:buffer';
import {expect,it,vi} from 'vitest';
import {parseScore,setOpeningTempo,setNotationInstrument,scorePitchDeclaration,notationInstrumentChoice,soundingEvents} from '../src/lib/score';
import {newProject,exportProject,importProject} from '../src/lib/storage';
import {changeNotationInstrument,undoProject} from '../src/lib/project';
import {scoreReference,alignmentMapSignature,alignmentMatchesReference} from '../src/lib/score-reference';
import {tempoMap} from '../src/lib/time';
vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',Blob);
const note=(step:string,duration=1,extra='')=>`<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>${duration}</duration><voice>lead</voice><staff>1</staff>${extra}</note>`;
const attrs='<attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time><key><fifths>1</fifths></key></attributes>';
const xml=`<score-partwise><part-list><score-part id="P1"><part-name>Voice</part-name></score-part><score-part id="P2"><part-name>Other</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes">${attrs}<direction><sound tempo="92"/></direction>${note('D')}</measure><measure number="1"><barline><repeat direction="forward"/></barline>${note('E',3)}</measure><measure number="2">${note('G',3)}<barline><repeat direction="backward"/></barline></measure></part><part id="P2"><measure number="0" implicit="yes">${attrs}<attributes><transpose><chromatic>-9</chromatic><diatonic>-5</diatonic></transpose></attributes>${note('B')}</measure><measure number="1">${note('C',3)}</measure><measure number="2">${note('D',3)}</measure></part></score-partwise>`;
const project=(value=xml)=>{const p=newProject('Reference');p.scoreXml=value;p.score=parseScore(value);p.scoreMap=tempoMap(p.score);return p;};
it('uses the canonical pickup and repeat route for every reference part, preserving transposition and voice',async()=>{
 const p=project(),reference=await scoreReference(p,true);expect(reference.parts.map(part=>part.id)).toEqual(['P2']);expect(reference.score.route.map(bar=>bar.measure)).toEqual([0,1,2,1,2]);expect(reference.score.events.map(note=>note.q)).toEqual([0,1,4,7,10]);expect(reference.score.events[0]).toMatchObject({midi:74,writtenMidi:83,voice:'lead',staff:1,part:'P2'});expect(reference.pitch).toBe('xml');
});
it('keeps reference identity through tempo-only changes and invalidates changed notation, pitch, voice or route',async()=>{
 const p=project(),ref=await scoreReference(p),changed=project(setOpeningTempo(xml,140));expect((await scoreReference(changed)).signature).toBe(ref.signature);
 for(const value of [setNotationInstrument(xml,'P1','alto'),xml.replace('<step>D</step>','<step>F</step>'),xml.replace('<voice>lead</voice>','<voice>other</voice>'),xml.replace('<repeat direction="backward"/>','')])expect((await scoreReference(project(value))).signature).not.toBe(ref.signature);
 expect(await alignmentMapSignature([{q:0,seconds:-1},{q:2,seconds:1}])).not.toBe(await alignmentMapSignature([{q:0,seconds:0},{q:2,seconds:1}]));
});
it('uses normal omitted-transpose XML semantics while respecting explicit pitch declarations',()=>{
 expect(scorePitchDeclaration(xml,'P1')).toBe('default');expect(notationInstrumentChoice(xml,'P1')).toBeNull();expect(()=>setNotationInstrument(xml,'P2','alto')).toThrow('already declares');
 const concert=xml.replace('<part-list>','<defaults><concert-score/></defaults><part-list>');expect(scorePitchDeclaration(concert,'P1')).toBe('concert');expect(()=>setNotationInstrument(concert,'P1','alto')).toThrow();
 const forPart=xml.replace('<part-list>','<defaults><concert-score/></defaults><part-list>').replace(attrs,attrs.replace('</attributes>','<for-part><part-transpose><diatonic>-5</diatonic><chromatic>-9</chromatic></part-transpose></for-part></attributes>'));expect(parseScore(forPart).events[0].midi).toBe(74);expect(()=>setNotationInstrument(forPart,'P1','alto')).toThrow();
});
it('changes sounding pitch by metadata while retaining written notes, key, sources and undo/redo archive history',async()=>{
 const p=project(),before=p.score!.events.map(note=>note.writtenMidi),changed=changeNotationInstrument(p,'alto');expect(changed.score!.events[0]).toMatchObject({writtenMidi:74,midi:65});expect(changed.score!.events.map(note=>note.writtenMidi)).toEqual(before);expect(changed.scoreXml).toContain('<fifths>1</fifths>');expect(changed.scoreXml).toContain('<diatonic>-5</diatonic><chromatic>-9</chromatic>');expect(changed.assetIds).toEqual(p.assetIds);expect(changed.takes).toEqual(p.takes);expect(p.scoreXml).toBe(xml);
 expect(notationInstrumentChoice(changed.scoreXml!,'P1')).toBe('alto');expect(parseScore(setNotationInstrument(changed.scoreXml!,'P1','tenor')).events[0].midi).toBe(60);expect(parseScore(setNotationInstrument(changed.scoreXml!,'P1','concert')).events[0].midi).toBe(74);
 const restored=await importProject(await exportProject(changed)),undone=undoProject(restored);expect(undone.score!.events[0].midi).toBe(74);expect(undoProject(undone,true).score!.events[0].midi).toBe(65);expect(undone.referenceTrackId).toBeUndefined();
});
it('does not merge matching tied pitches belonging to different parts',()=>{
 const p=project(),base=p.score!.events[0];p.score!.events=[{...base,q:0,duration:1,part:'P1',tieStart:true},{...base,q:1,duration:1,part:'P2',tieStop:true}];expect(soundingEvents(p.score!)).toHaveLength(2);
});
it('will not reuse a legacy or explicitly risky missing-transpose demo as content-verified reference',async()=>{
 const unspecified=await scoreReference(project(xml.replace('<part-name>Voice</part-name>','<part-name>Alto Saxophone</part-name>'))),declared=await scoreReference(project(setNotationInstrument(xml,'P1','concert')));
 const alignment={anchors:[{q:0,seconds:0},{q:13,seconds:8}],method:'chroma-dtw' as const,status:'accepted' as const,warnings:[]};expect(alignmentMatchesReference(alignment,declared)).toBe(false);
 const withRef={...alignment,reference:{kind:'score-part' as const,scoreSignature:unspecified.signature,partIds:['P1'],pitch:'unspecified' as const,sampleRate:48000}};expect(alignmentMatchesReference(withRef,unspecified)).toBe(false);expect(alignmentMatchesReference({...withRef,reference:{...withRef.reference,scoreSignature:declared.signature,pitch:'xml'}},declared)).toBe(true);
});
it('round-trips provenance and decoded-source cues through backup, rejecting malformed evidence',async()=>{
 const p=project(setNotationInstrument(xml,'P1','alto')),ref=await scoreReference(p),alignment={anchors:[{q:0,seconds:-.3},{q:13,seconds:8}],status:'accepted' as const,method:'chroma-dtw' as const,warnings:[],reference:{kind:'score-part' as const,scoreSignature:ref.signature,partIds:['P1'],pitch:'xml' as const,sampleRate:48000},assessment:{basis:'score-notes' as const,decision:'supported' as const,supportedFraction:.8,reasons:[],points:[{q:1,sourceSample:9600,midi:[65],support:.9,attack:.8}]}};
 p.tracks=[{id:'empty',name:'No source',role:'recording',offset:0,volume:1,pan:0,mute:false,solo:false,color:0,clips:[],alignment}];
 const imported=await importProject(await exportProject(p));expect(imported.tracks[0].alignment).toEqual(alignment);
 for(const point of [{...alignment.assessment.points[0],sourceSample:-1},{...alignment.assessment.points[0],q:99},{...alignment.assessment.points[0],support:2}]){p.tracks[0].alignment!.assessment!.points=[point];await expect(importProject(await exportProject(p))).rejects.toThrow('alignment evidence');}
});

it.each(['Piano','Flute','Violin','Voice'])('preserves the zero-transposition default for ordinary %s XML without requiring confirmation',async name=>{
 const value=xml.replace('<part-name>Voice</part-name>',`<part-name>${name}</part-name>`),reference=await scoreReference(project(value));expect(scorePitchDeclaration(value,'P1')).toBe('default');expect(reference.pitch).toBe('xml');expect(reference.score.events[0]).toMatchObject({writtenMidi:74,midi:74});
});
it('requires review only for an explicitly named transposing instrument with no pitch declaration',async()=>{
 const value=xml.replace('<part-name>Voice</part-name>','<part-name>Alto Saxophone</part-name>');expect(scorePitchDeclaration(value,'P1')).toBe('unspecified');expect((await scoreReference(project(value))).pitch).toBe('unspecified');expect(parseScore(setNotationInstrument(value,'P1','alto')).events[0].midi).toBe(65);
});
