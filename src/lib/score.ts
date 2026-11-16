import {unzipSync, strFromU8} from 'fflate';
import type {Score, ScorePart, ScoreMeasure, ScoreNote, ScoreOccurrence, ScoreEvent} from './types';

const children = (e: Element, name: string) => Array.from(e.children).filter(c => c.localName === name);
const child = (e: Element, name: string) => children(e, name)[0];
const txt = (e: Element | undefined, name?: string, fallback = '') => (name ? e && child(e, name)?.textContent : e?.textContent)?.trim() || fallback;
const num = (e: Element | undefined, name?: string, fallback = 0) => {
  const v = Number(txt(e, name, String(fallback))); return Number.isFinite(v) ? v : fallback;
};
const all = (e: Element, name: string) => Array.from(e.getElementsByTagName(name));
const notesByStep: Record<string, number> = {C:0, D:2, E:4, F:5, G:7, A:9, B:11};
const noteLength: Record<string, number> = {maxima:32, long:16, breve:8, whole:4, half:2, quarter:1, eighth:.5, '16th':.25, '32nd':.125, '64th':.0625};
const MAX_XML = 24 * 1024 * 1024;

export function parseXml(xml: string): XMLDocument {
  if (xml.length > MAX_XML) throw Error('MusicXML 文件过大 / Score exceeds 24 MB');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) throw Error('不支持带实体声明的 XML / XML entities are not allowed');
  const doc = new DOMParser().parseFromString(xml.replace(/<!DOCTYPE[^>]*>/gi, ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('MusicXML 格式损坏 / Invalid MusicXML');
  return doc;
}

export async function readScoreFile(file: File | Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    const xml = new TextDecoder().decode(bytes); parseXml(xml); return xml;
  }
  let total = 0;
  const entries = unzipSync(bytes, {filter: info => {
    if (info.name.startsWith('/') || info.name.split('/').includes('..')) throw Error('无效压缩文件路径 / Unsafe archive path');
    if (!/\.(xml|musicxml)$/i.test(info.name)) return false;
    total += info.originalSize;
    if (info.originalSize > MAX_XML || total > MAX_XML * 2) throw Error('MXL 解压后过大 / MXL exceeds size limit');
    return true;
  }});
  const container = entries['META-INF/container.xml'];
  let path = '';
  if (container) {
    const doc = parseXml(strFromU8(container));
    path = Array.from(doc.getElementsByTagName('rootfile')).find(e => e.getAttribute('media-type') === 'application/vnd.recordare.musicxml+xml')?.getAttribute('full-path') || doc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path') || '';
  }
  if (!path) path = Object.keys(entries).find(p => !p.startsWith('META-INF/')) || '';
  if (!entries[path]) throw Error('MXL 没有找到乐谱 / Missing MusicXML root file');
  const xml = strFromU8(entries[path]); parseXml(xml); return xml;
}

function parsePart(part: Element, name: string, warnings: string[]): ScorePart {
  const id = part.getAttribute('id') || 'P1';
  let divisions = 1, beats = 4, beatType = 4, transpose = 0, absoluteQ = 0;
  let activeEndings: number[] = [];
  const measures = children(part, 'measure').map((el, index): ScoreMeasure => {
    let cursor = 0, maxEnd = 0, priorOnset = 0, sequence = 0;
    const notes: ScoreNote[] = [], tempo: ScoreMeasure['tempo'] = [];
    const initialTime = children(el, 'attributes').flatMap(a => children(a, 'time'))[0];
    if (initialTime && child(initialTime, 'beats')) {
      beats = txt(initialTime, 'beats').split('+').reduce((sum,n) => sum + Number(n),0);
      beatType = num(initialTime, 'beat-type', 4);
      if (!(beats > 0 && beatType > 0)) throw Error('无效拍号 / Invalid time signature');
    }
    const number = el.getAttribute('number') || String(index + 1);
    const expected = beats * 4 / beatType;
    const m: ScoreMeasure = {index, number, q:absoluteQ, duration:expected, beats, beatType, notes, repeatStart:false, repeatEnd:0, endings:[], tempo};
    const endingStarts = all(el, 'ending').filter(e => e.getAttribute('type') === 'start');
    if (endingStarts.length) activeEndings = (endingStarts[0].getAttribute('number') || '').split(/[ ,]+/).map(Number).filter(v => v > 0);
    m.endings = [...activeEndings];
    for (const item of Array.from(el.children)) {
      switch (item.localName) {
        case 'attributes': {
          if (child(item, 'divisions')) divisions = num(item, 'divisions', 1);
          if (!(divisions > 0)) throw Error('无效 divisions / Invalid rhythmic divisions');
          const tr = child(item, 'transpose');
          if (tr) transpose = num(tr, 'chromatic') + num(tr, 'octave-change') * 12;
          break;
        }
        case 'backup': cursor = Math.max(0, cursor - num(item, 'duration') / divisions); break;
        case 'forward': cursor += num(item, 'duration') / divisions; maxEnd = Math.max(maxEnd, cursor); break;
        case 'note': {
          const grace = !!child(item, 'grace'), chord = !!child(item, 'chord');
          const onset = chord ? priorOnset : cursor;
          let duration = grace ? 0 : num(item, 'duration') / divisions;
          if (!grace && !child(item, 'duration')) {
            if (child(item, 'rest')?.getAttribute('measure') === 'yes') duration = expected;
            else {
              duration = noteLength[txt(item, 'type')] || 1;
              let dot = duration;
              for (const _ of children(item,'dot')) { dot /= 2; duration += dot; }
              const tm = child(item, 'time-modification');
              if (tm) duration *= num(tm,'normal-notes',1) / num(tm,'actual-notes',1);
              warnings.push(`第 ${number} 小节缺少时值，按记谱推导 / Duration inferred in measure ${number}`);
            }
          }
          const pitch = child(item, 'pitch');
          const writtenMidi = pitch ? 12 * (num(pitch,'octave',4) + 1) + (notesByStep[txt(pitch,'step')] ?? 0) + num(pitch,'alter') : null;
          if (child(item,'unpitched')) warnings.push('未定音高声部只参与节奏，不参与旋律匹配 / Unpitched notes excluded from pitch matching');
          const ties = [...children(item,'tie'), ...all(item,'tied')];
          notes.push({id:`${id}:${index}:${sequence++}`,part:id,measure:index,onset,duration,
            midi:writtenMidi === null ? null : writtenMidi + transpose, writtenMidi,
            voice:txt(item,'voice','1'),staff:num(item,'staff',1),grace,
            tieStart:ties.some(t => t.getAttribute('type') === 'start'),tieStop:ties.some(t => t.getAttribute('type') === 'stop')});
          if (!chord) { priorOnset = onset; if (!grace) cursor += duration; }
          maxEnd = Math.max(maxEnd, onset + duration);
          break;
        }
        case 'direction':
        case 'sound': {
          const sounds = item.localName === 'sound' ? [item] : all(item, 'sound');
          const offset = item.localName === 'direction' ? num(item,'offset')/divisions : 0;
          for (const sound of sounds) {
            const bpm = Number(sound.getAttribute('tempo'));
            if (bpm > 0) tempo.push({offset:cursor+offset,bpm});
            if (sound.hasAttribute('segno')) m.segno = sound.getAttribute('segno') || 'segno';
            if (sound.hasAttribute('coda')) m.coda = sound.getAttribute('coda') || 'coda';
            if (sound.getAttribute('dacapo') === 'yes') m.jump = 'dc';
            if (sound.hasAttribute('dalsegno')) {m.jump='ds';m.jumpLabel=sound.getAttribute('dalsegno') || 'segno';}
            if (sound.hasAttribute('tocoda')) m.toCoda = sound.getAttribute('tocoda') || 'coda';
            if (sound.hasAttribute('fine')) m.fine = true;
          }
          const metro = all(item,'metronome')[0];
          if (metro && !sounds.some(s => s.hasAttribute('tempo'))) {
            let unit = noteLength[txt(metro,'beat-unit')] || 1;
            if (child(metro,'beat-unit-dot')) unit *= 1.5;
            const bpm = num(metro,'per-minute') * unit;
            if (bpm > 0) tempo.push({offset:cursor+offset,bpm});
          }
          const words = all(item,'words').map(e=>txt(e)).join(' ');
          if (/D\.?\s*[CS]\.?|dal segno|da capo/i.test(words) && !m.jump) warnings.push(`第 ${number} 小节的跳转只有文字，需确认演奏顺序 / Text-only jump in measure ${number}`);
          break;
        }
        case 'barline': {
          const repeat = child(item, 'repeat');
          if (repeat?.getAttribute('direction') === 'forward') m.repeatStart = true;
          if (repeat?.getAttribute('direction') === 'backward') m.repeatEnd = Math.max(2,Number(repeat.getAttribute('times')) || 2);
          break;
        }
      }
    }
    if (maxEnd > expected + 1e-6) {
      warnings.push(`第 ${number} 小节时值超出拍号 / Overfull measure ${number}`);
      m.duration = maxEnd;
    } else if (maxEnd > 0 && maxEnd < expected - 1e-6) {
      if (el.getAttribute('implicit') === 'yes' || index === 0) m.duration = maxEnd;
      else warnings.push(`第 ${number} 小节时值不完整 / Incomplete measure ${number}`);
    }
    if (all(el,'ending').some(e=>['stop','discontinue'].includes(e.getAttribute('type') || ''))) activeEndings = [];
    absoluteQ += m.duration;
    return m;
  });
  return {id, name, measures};
}

export function expandRoute(measures: ScoreMeasure[]): ScoreOccurrence[] {
  const route: ScoreOccurrence[] = [];
  let index = 0, start = 0, q = 0, pass = 1, jumped = false, hops = 0;
  const completed = new Map<number,number>();
  while (index < measures.length) {
    if (++hops > Math.max(1000,measures.length*20)) throw Error('反复跳转无法结束 / Unbounded repeat route');
    const m = measures[index];
    if (m.repeatStart && pass === 1) start = index;
    const included = !m.endings.length || m.endings.includes(pass);
    if (included) {
      route.push({id:`${index}:${route.length}`,measure:index,number:m.number,q,duration:m.duration,pass});
      q += m.duration;
    }
    if (included && jumped && m.fine) break;
    if (included && jumped && m.toCoda) {
      const target = measures.findIndex((v,i)=>i>index && v.coda===m.toCoda);
      if (target>=0) {index=target;continue;}
    }
    if (included && m.jump && !jumped) {
      jumped=true;pass=1;completed.clear();
      const target = m.jump==='dc'?0:measures.findIndex(v=>v.segno===m.jumpLabel);
      if (target<0) throw Error('找不到跳转标记 / Missing segno');
      index=target;continue;
    }
    if (m.repeatEnd && !jumped) {
      const current=completed.get(index) || 1;
      if (current<m.repeatEnd) {completed.set(index,current+1);pass=current+1;index=start;continue;}
      completed.set(index,current);
      // Retain pass through a following second ending, then return to pass one.
      if (!measures[index+1]?.endings.length) {pass=1;start=index+1;}
    } else if (!m.endings.length && pass>1 && !measures[index+1]?.endings.length && completed.has(index-1)) pass=1;
    index++;
  }
  return route;
}

export function parseScore(xml: string, selectedPart?: string): Score {
  const doc = parseXml(xml), root=doc.documentElement;
  if (root.localName!=='score-partwise') throw Error('请导出 partwise MusicXML / Export score-partwise MusicXML');
  const names = new Map(all(root,'score-part').map(p=>[p.getAttribute('id') || '',txt(p,'part-name','Part')]));
  const warnings: string[]=[];
  const parts=children(root,'part').map(p=>parsePart(p,names.get(p.getAttribute('id') || '') || 'Part',warnings));
  if (!parts.length || !parts[0].measures.length) throw Error('乐谱没有小节 / The score has no measures');
  const part=parts.find(p=>p.id===selectedPart) || parts[0], route=expandRoute(part.measures);
  const events: ScoreEvent[]=[], tempo: Score['tempo']=[];
  const tempoMissing=!part.measures[0].tempo.some(t=>t.offset===0)&&!parts[0].measures[0].tempo.some(t=>t.offset===0);
  if(tempoMissing)warnings.push('乐谱开头没有数字速度标记，请先确认谱面速度 / No initial numeric tempo; confirm the score tempo before practicing');
  let bpm=80;
  for (const occurrence of route) {
    const m=part.measures[occurrence.measure];
    // Tempo often lives only in the first part of a multi-part score.
    const changes=m.tempo.length?m.tempo:parts[0].measures[m.index]?.tempo || [];
    if (occurrence===route[0] && !changes.some(t=>t.offset===0)) tempo.push({q:0,bpm});
    for (const t of changes) {bpm=t.bpm;tempo.push({q:occurrence.q+t.offset,bpm});}
    for (const n of m.notes) events.push({...n,q:occurrence.q+n.onset,occurrence:occurrence.id});
  }
  const totalQ=route.reduce((sum,m)=>sum+m.duration,0);
  if (totalQ>20000 || events.length>100000) throw Error('乐谱过长 / Score exceeds the practice project limit');
  return {title:txt(all(root,'work-title')[0]) || txt(all(root,'movement-title')[0]) || 'Untitled',
    composer:all(root,'creator').filter(c=>c.getAttribute('type')==='composer').map(c=>txt(c)).join(', '),
    partId:part.id,parts:parts.map(p=>({id:p.id,name:p.name})),measures:part.measures,route,
    events:events.sort((a,b)=>a.q-b.q),tempo,totalQ,tempoMissing,warnings:[...new Set(warnings)]};
}

export function soundingEvents(score: Score): ScoreEvent[] {
  const result: ScoreEvent[]=[], ties=new Map<string,ScoreEvent>();
  for (const event of score.events) {
    if (event.midi===null || event.grace) continue;
    const key=`${event.part}:${event.voice}:${event.staff}:${event.midi}`;
    const preceding=ties.get(key);
    if (event.tieStop && preceding && Math.abs(preceding.q+preceding.duration-event.q)<1e-5) {
      preceding.duration+=event.duration;
      if (!event.tieStart) ties.delete(key);
      continue;
    }
    const copy={...event};result.push(copy);
    if (event.tieStart) ties.set(key,copy); else ties.delete(key);
  }
  return result;
}

export function setOpeningTempo(xml:string,bpm:number):string{
  if(!Number.isFinite(bpm)||bpm<20||bpm>400)throw Error('谱面速度需为 20–400 BPM / Score tempo must be 20–400 BPM');
  const doc=parseXml(xml),parts=all(doc.documentElement,'part');if(!parts.length)throw Error('乐谱没有声部 / Missing score parts');
  for(const part of parts){
    const measure=children(part,'measure')[0];if(!measure)continue;
    for(const element of Array.from(measure.children)){if(element.localName==='note')break;if(element.localName!=='direction'||Number(txt(element,'offset','0'))!==0)continue;for(const metro of all(element,'metronome')){const parent=metro.parentNode!;parent.removeChild(metro);if(!parent.hasChildNodes())element.removeChild(parent);}for(const sound of all(element,'sound')){sound.removeAttribute('tempo');if(!sound.attributes.length&&!sound.hasChildNodes())element.removeChild(sound);}if(!element.children.length)measure.removeChild(element);}
    const create=(name:string)=>doc.createElementNS(measure.namespaceURI,name),direction=create('direction'),type=create('direction-type'),metro=create('metronome'),unit=create('beat-unit'),minute=create('per-minute'),sound=create('sound');
    unit.textContent='quarter';minute.textContent=String(bpm);metro.append(unit,minute);type.append(metro);sound.setAttribute('tempo',String(bpm));direction.append(type,sound);
    const before=Array.from(measure.children).find(element=>element.localName!=='print'&&element.localName!=='attributes');measure.insertBefore(direction,before||null);
  }
  return new XMLSerializer().serializeToString(doc);
}

export type NotationInstrument='concert'|'alto'|'tenor'|'bb';
export function notationInstrumentChoice(xml:string,partId:string):NotationInstrument|null{
  const root=parseXml(xml).documentElement,part=children(root,'part').find(part=>part.getAttribute('id')===partId);if(!part||all(root,'concert-score').length||all(part,'for-part').length)return null;
  const transposes=all(part,'transpose');if(transposes.length!==1||transposes[0].getAttribute('id')!==`dripping-notation-${partId}`)return null;
  const shift=num(transposes[0],'chromatic')+12*num(transposes[0],'octave-change');return shift===0?'concert':shift===-9?'alto':shift===-14?'tenor':shift===-2?'bb':null;
}
export function scorePitchDeclaration(xml:string,partId:string):'concert'|'transpose'|'for-part'|'unspecified'{
  const root=parseXml(xml).documentElement,part=children(root,'part').find(part=>part.getAttribute('id')===partId);if(!part)throw Error('找不到乐谱声部 / Score part is missing');
  if(all(root,'concert-score').length)return 'concert';
  if(all(part,'transpose').length)return 'transpose';
  if(all(part,'for-part').length)return 'for-part';
  return 'unspecified';
}
export function setNotationInstrument(xml:string,partId:string,instrument:NotationInstrument):string{
  if(scorePitchDeclaration(xml,partId)!=='unspecified'&&!notationInstrumentChoice(xml,partId))throw Error('MusicXML 已声明记谱音高，保持原声明 / MusicXML already declares its pitch interpretation');
  const choices={concert:{diatonic:0,chromatic:0,octave:0},alto:{diatonic:-5,chromatic:-9,octave:0},tenor:{diatonic:-1,chromatic:-2,octave:-1},bb:{diatonic:-1,chromatic:-2,octave:0}},choice=choices[instrument];if(!choice)throw Error('无效记谱乐器 / Invalid notation instrument');
  const doc=parseXml(xml),part=children(doc.documentElement,'part').find(part=>part.getAttribute('id')===partId)!,measure=children(part,'measure')[0];if(!measure)throw Error('乐谱没有小节 / Missing score measures');
  const create=(name:string)=>doc.createElementNS(measure.namespaceURI,name);let attributes=child(measure,'attributes');if(!attributes){attributes=create('attributes');measure.insertBefore(attributes,measure.firstChild);}
  for(const previous of all(part,'transpose'))previous.remove();const transpose=create('transpose'),diatonic=create('diatonic'),chromatic=create('chromatic');transpose.setAttribute('id',`dripping-notation-${partId}`);diatonic.textContent=String(choice.diatonic);chromatic.textContent=String(choice.chromatic);transpose.append(diatonic,chromatic);
  if(choice.octave){const octave=create('octave-change');octave.textContent=String(choice.octave);transpose.append(octave);}
  attributes.insertBefore(transpose,Array.from(attributes.children).find(element=>['directive','measure-style','for-part'].includes(element.localName))||null);return new XMLSerializer().serializeToString(doc);
}
