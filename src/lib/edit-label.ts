import type {Locale} from './types';

export function editLabel(label:string|undefined,locale:Locale):string{
  if(!label)return '';
  const labels:Record<string,[string,string]>={split:['分割片段','Split region'],clear:['清除选区','Clear selection'],trim:['保留选区','Trim to selection'],fade:['添加淡入淡出','Add fades'],'trim region':['裁剪片段','Trim region'],'remove track':['移除音轨','Remove track'],'add recording track':['新增录音轨','Add recording track'],record:['录音','Recording'],'align to score':['对齐到谱面','Align to score']};
  return labels[label]?.[locale==='zh'?0:1]||label;
}
