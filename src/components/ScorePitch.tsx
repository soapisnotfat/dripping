import {useMemo} from 'react';
import type {Locale} from '../lib/types';
import {scorePitchDeclaration,notationInstrumentChoice,type NotationInstrument} from '../lib/score';

export function ScorePitch({xml,partId,locale,disabled,onChange}:{xml:string;partId:string;locale:Locale;disabled:boolean;onChange:(instrument:NotationInstrument)=>void}){
  const t=(zh:string,en:string)=>locale==='zh'?zh:en,{declaration,choice}=useMemo(()=>({declaration:scorePitchDeclaration(xml,partId),choice:notationInstrumentChoice(xml,partId)}),[xml,partId]);
  return <div className="score-pitch">{declaration==='default'||declaration==='unspecified'||choice?<label>{t('谱面记谱','Score notation')} <select aria-label={t('谱面记谱音高','Score notation pitch')} disabled={disabled} value={choice||''} onChange={event=>onChange(event.target.value as NotationInstrument)}><option value="" disabled>{declaration==='default'?t('XML 默认：不移调','XML default: no transposition'):t('移调乐器缺少声明','Transposing instrument: declaration missing')}</option><option value="concert">{t('实音谱 / C 乐器','Concert pitch / C instrument')}</option><option value="alto">{t('E♭ 中音萨克斯移调谱','E♭ alto sax written pitch')}</option><option value="tenor">{t('B♭ 次中音萨克斯移调谱','B♭ tenor sax written pitch')}</option><option value="bb">{t('B♭ 乐器移调谱','B♭ instrument written pitch')}</option></select></label>:<span>{t('记谱音高：遵循 MusicXML 声明','Notation pitch: declared by MusicXML')}</span>}{declaration==='unspecified'&&<small>{t('有移调的乐器请确认记谱方式；此项决定实际音高。','For a transposing instrument, choose its notation to set sounding pitch.')}</small>}</div>;
}
