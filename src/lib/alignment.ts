import type {Score, Anchor, Alignment, PCM} from './types';
import {clamp} from './types';
import {soundingEvents} from './score';
import {tempoMap, secondsToQ, qToSeconds, validateAnchors,beatGrid} from './time';
import {stretchAudio, slicePCM} from './audio';

export type Features={values:Float32Array;bass?:Float32Array;energy:Float32Array;frames:number;hop:number;duration:number};
function fft(real:Float32Array,imag:Float32Array){
  const n=real.length;
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[real[i],real[j]]=[real[j],real[i]];[imag[i],imag[j]]=[imag[j],imag[i]];}}
  for(let len=2;len<=n;len<<=1){
    const angle=-2*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let i=0;i<n;i+=len){let ur=1,ui=0;for(let j=0;j<len/2;j++){
      const a=i+j,b=a+len/2,vr=real[b]*ur-imag[b]*ui,vi=real[b]*ui+imag[b]*ur;
      real[b]=real[a]-vr;imag[b]=imag[a]-vi;real[a]+=vr;imag[a]+=vi;
      const next=ur*wr-ui*wi;ui=ur*wi+ui*wr;ur=next;
    }}
  }
}
export function audioFeatures(samples:Float32Array,sampleRate=11025,hop=.1):Features {
  const window=2048,frames=Math.max(1,Math.ceil(samples.length/sampleRate/hop));
  const values=new Float32Array(frames*12),bass=new Float32Array(frames*12),energy=new Float32Array(frames),real=new Float32Array(window),imag=new Float32Array(window);
  const bins=Array.from({length:window/2},(_,k)=>{
    const midi=69+12*Math.log2((k*sampleRate/window)/440);
    return midi>=36&&midi<=96?{pitch:((Math.round(midi)%12)+12)%12,weight:Math.max(0,1-Math.abs(midi-Math.round(midi))),bass:midi<60}:null;
  });
  for(let f=0;f<frames;f++){
    const center=Math.round((f+.5)*hop*sampleRate);let sum=0;
    for(let i=0;i<window;i++){const v=samples[center+i-window/2]||0;sum+=v*v;real[i]=v*(.5-.5*Math.cos(2*Math.PI*i/(window-1)));imag[i]=0;}
    energy[f]=Math.sqrt(sum/window);fft(real,imag);
    for(let k=1;k<window/2;k++){const bin=bins[k];if(bin){const value=Math.pow(real[k]**2+imag[k]**2,.35)*bin.weight;values[f*12+bin.pitch]+=value;if(bin.bass)bass[f*12+bin.pitch]+=value;}}
    const offset=f*12;
    for(const features of [values,bass]){
      const mean=features.slice(offset,offset+12).reduce((a,b)=>a+b,0)/12;
      let norm=0;for(let c=0;c<12;c++){features[offset+c]=Math.max(0,features[offset+c]-mean*.6);norm+=features[offset+c]**2;}
      norm=Math.sqrt(norm);if(norm>1e-9)for(let c=0;c<12;c++)features[offset+c]/=norm;
    }
  }
  return {values,bass,energy,frames,hop,duration:samples.length/sampleRate};
}
export function scoreFeatures(score:Score,hop=.1):Features {
  const map=tempoMap(score),duration=qToSeconds(score.totalQ,map),frames=Math.max(1,Math.ceil(duration/hop));
  const values=new Float32Array(frames*12),energy=new Float32Array(frames);
  for(const event of soundingEvents(score)){
    const a=qToSeconds(event.q,map),b=qToSeconds(event.q+event.duration,map),pc=((Math.round(event.midi!)%12)+12)%12;
    for(let f=Math.max(0,Math.floor(a/hop));f<Math.min(frames,Math.ceil(b/hop));f++){
      const overlap=Math.max(0,Math.min(b,(f+1)*hop)-Math.max(a,f*hop))/hop;
      values[f*12+pc]+=overlap;energy[f]+=overlap;
    }
  }
  for(let f=0;f<frames;f++){let norm=0;for(let p=0;p<12;p++)norm+=values[f*12+p]**2;norm=Math.sqrt(norm);if(norm)for(let p=0;p<12;p++)values[f*12+p]/=norm;}
  return {values,energy,frames,hop,duration};
}

function soundingWindow(features:Features):{features:Features;offset:number}{
  const first=features.energy.findIndex(value=>value>0);let end=features.frames;
  while(end>first&&features.energy[end-1]===0)end--;
  if(first<0)throw Error('谱面没有可匹配音符 / The score has no pitched notes to match');
  return {offset:first*features.hop,features:{...features,values:features.values.slice(first*12,end*12),energy:features.energy.slice(first,end),frames:end-first,duration:(end-first)*features.hop}};
}

export function dtw(reference:Features,audio:Features,compareBacking=false):{path:[number,number][];cost:number;coverage:number} {
  const m=reference.frames,n=audio.frames;
  if(m*n>20_000_000)throw Error('匹配范围过大，请先裁短素材 / Alignment input is too long');
  let previous=new Float32Array(n+1).fill(Infinity),previous2=previous.slice();
  // Subsequence initialization permits extra prelude/outro in the recording.
  previous.fill(0);previous2[0]=0;
  const direction=new Uint8Array((m+1)*(n+1));
  const peak=Math.max(...audio.energy),silence=Math.max(.00005,peak*.012);
  for(let i=1;i<=m;i++){
    const current=new Float32Array(n+1).fill(Infinity);
    const center=i/m*n,band=Math.max(80,n*.35);
    const begin=Math.max(1,Math.floor(center-band)),end=Math.min(n,Math.ceil(center+band));
    for(let j=begin;j<=end;j++){
      const r=i-1,a=j-1;let distance=0;
      if(reference.energy[r]<.01)distance=audio.energy[a]<silence?.05:.3;
      else if(audio.energy[a]<silence)distance=.95;
      else {
        let dot=0,bassDot=0;
        for(let p=0;p<12;p++){dot+=reference.values[r*12+p]*audio.values[a*12+p];if(compareBacking&&reference.bass&&audio.bass)bassDot+=reference.bass[r*12+p]*audio.bass[a*12+p];}
        // Shared lower-register accompaniment remains useful when the demo adds a dominant solo melody.
        if(compareBacking&&reference.bass&&audio.bass)dot=.25*dot+.75*bassDot;
        distance=1-clamp(dot,0,1);
      }
      const choices=[previous[j-1],j>1?previous[j-2]+.04:Infinity,i>1?previous2[j-1]+.04:Infinity];
      let which=0;if(choices[1]<choices[which])which=1;if(choices[2]<choices[which])which=2;
      current[j]=choices[which]+distance*(which===0?1:1.5);
      direction[i*(n+1)+j]=which+1;
    }
    previous2=previous;previous=current;
  }
  let end=1;for(let j=2;j<=n;j++)if(previous[j]<previous[end])end=j;
  if(!Number.isFinite(previous[end]))throw Error('无法找到连续匹配 / No continuous alignment found');
  const totalCost=previous[end];
  let i=m,j=end;const path:[number,number][]=[];
  while(i>0&&j>0){path.push([i-1,j-1]);const d=direction[i*(n+1)+j];if(d===1){i--;j--;}else if(d===2){i--;j-=2;}else if(d===3){i-=2;j--;}else break;}
  path.reverse();
  return {path,cost:totalCost/Math.max(1,path.length),coverage:path.length/Math.max(1,m)};
}

function pathAnchors(path:[number,number][],ref:Features,audio:Features,toQ:(time:number)=>number,totalQ:number):Anchor[] {
  const anchors:Anchor[]=[];
  const stride=Math.max(1,Math.floor(path.length/Math.min(250,path.length)));
  for(let k=0;k<path.length;k+=stride){
    const [i,j]=path[k],q=clamp(toQ((i+.5)*ref.hop),0,totalQ),seconds=(j+.5)*audio.hop;
    const last=anchors.at(-1);if(!last||(q>last.q+1e-5&&seconds>last.seconds+1e-5))anchors.push({q,seconds});
  }
  if(anchors.length<2)throw Error('匹配点不足 / Not enough alignment evidence');
  // Extrapolate only a feature-window edge, never fabricate a zero offset.
  const firstSeconds=qToSeconds(0,anchors),endSeconds=qToSeconds(totalQ,anchors);
  if(anchors[0].q>0)anchors.unshift({q:0,seconds:firstSeconds});
  if(anchors.at(-1)!.q<totalQ)anchors.push({q:totalQ,seconds:endSeconds});
  return validateAnchors(anchors);
}
export function alignToScore(score:Score,audio:Features):Alignment {
  if(score.tempoMissing)throw Error('先输入明确谱面速度 / Enter the score tempo first');
  // A trimmed recording need not contain leading/trailing written rests. Keep
  // internal rests as structure, and restore the original musical q offset when
  // converting the matched window back to score positions.
  const window=soundingWindow(scoreFeatures(score,audio.hop)),reference=window.features,result=dtw(reference,audio),map=tempoMap(score);
  const anchors=pathAnchors(result.path,reference,audio,t=>secondsToQ(t+window.offset,map),score.totalQ);
  const warnings:string[]=[];
  if(result.cost>.55)warnings.push('旋律匹配较弱，请试听或使用示范轨辅助 / Weak melody match; review or use a demonstration track');
  if(result.coverage<.65)warnings.push('速度差异较大，检查是否为同一版本 / Large tempo differences; check the arrangement');
  if(anchors[0].seconds<-.2)warnings.push('音频可能缺少乐谱开头 / Recording may omit the beginning');
  return {anchors,status:'candidate',method:'chroma-dtw',cost:result.cost,coverage:result.coverage,warnings};
}
export function alignToDemo(score:Score,demo:Features,demoMap:Anchor[],audio:Features):Alignment {
  if(score.tempoMissing)throw Error('先输入明确谱面速度 / Enter the score tempo first');
  const result=dtw(demo,audio,true),anchors=pathAnchors(result.path,demo,audio,t=>secondsToQ(t,demoMap),score.totalQ);
  return {anchors,status:'candidate',method:'chroma-dtw',cost:result.cost,coverage:result.coverage,
    warnings:result.cost>.5?['示范与此音轨匹配较弱 / Weak match between demonstration and track']:[]};
}

export function pairSourceAnchor(totalQ:number,anchors:Anchor[],edited:number[],q:number,seconds:number):{anchors:Anchor[];manualAnchors:number[]}{
  if(!Number.isFinite(q)||q<0||q>totalQ||!Number.isFinite(seconds)||seconds<0)throw Error('选择谱内位置与原音中的实际位置 / Choose a score position and a point inside the source');
  const pairs=edited.filter(at=>Math.abs(at-q)>1e-7).map(at=>({q:at,seconds:qToSeconds(at,anchors)})).concat({q,seconds}).sort((a,b)=>a.q-b.q);
  if(pairs.length>=2){
    validateAnchors(pairs);const result=[...pairs];if(result[0].q>0)result.unshift({q:0,seconds:qToSeconds(0,pairs)});if(result.at(-1)!.q<totalQ)result.push({q:totalQ,seconds:qToSeconds(totalQ,pairs)});
    return {anchors:validateAnchors(result),manualAnchors:pairs.map(point=>point.q)};
  }
  // One pair translates the provisional curve. Once a second real pair exists,
  // interpolate through those pairs and extrapolate the score edges; untouched
  // score-tempo endpoints must not contradict the user's actual source points.
  const delta=seconds-qToSeconds(q,anchors),result=anchors.filter(point=>Math.abs(point.q-q)>1e-7).map(point=>({...point,seconds:point.seconds+delta})).concat({q,seconds}).sort((a,b)=>a.q-b.q);
  return {anchors:validateAnchors(result),manualAnchors:[q]};
}

export function conformKnots(score:Score,sourceMap:Anchor[],targetMap:Anchor[],manualAnchors:number[]=[]):number[]{
  validateAnchors(sourceMap);validateAnchors(targetMap);
  const start=Math.max(sourceMap[0].q,targetMap[0].q),end=Math.min(sourceMap.at(-1)!.q,targetMap.at(-1)!.q);
  if(manualAnchors.some(q=>!Number.isFinite(q)||q<start||q>end))throw Error('无效手动音乐锚点 / Invalid manual musical anchor');
  const unique=(values:number[])=>values.filter(q=>q>=start&&q<=end).sort((a,b)=>a-b).filter((q,index,all)=>!index||q-all[index-1]>1e-7);
  const fixed=unique([start,end,...targetMap.map(anchor=>anchor.q),...score.tempo.map(change=>change.q),...score.route.flatMap(bar=>[bar.q,bar.q+bar.duration]),...manualAnchors]);
  const candidates=unique([...beatGrid(score),...fixed]),kept=new Set(fixed),beatSize=(q:number)=>{const bar=[...score.route].reverse().find(bar=>bar.q<=q+1e-7)||score.route[0];return 4/score.measures[bar.measure].beatType;};
  // Sample automatic frame paths on the score's beat grid, then keep only
  // bends that move a musical beat by more than 1/16 beat. Written tempo,
  // bar boundaries and explicitly edited offbeat anchors are never removed.
  const pending=fixed.slice(1).map((q,index)=>[fixed[index],q]);
  while(pending.length){
    const [a,b]=pending.pop()!,sourceA=qToSeconds(a,sourceMap),sourceB=qToSeconds(b,sourceMap),targetA=qToSeconds(a,targetMap),targetB=qToSeconds(b,targetMap);
    let worst=1/16,split:number|undefined;
    for(const q of candidates){if(q<=a||q>=b)continue;const output=targetA+(qToSeconds(q,sourceMap)-sourceA)/(sourceB-sourceA)*(targetB-targetA),error=Math.abs(secondsToQ(output,targetMap)-q)/beatSize(q);if(error>worst){worst=error;split=q;}}
    if(split!==undefined){kept.add(split);pending.push([a,split],[split,b]);}
  }
  return [...kept].sort((a,b)=>a-b);
}

export function conformAudio(pcm:PCM,sourceMap:Anchor[],targetMap:Anchor[],duration:number,score:Score,manualAnchors:number[]=[]):PCM {
  validateAnchors(sourceMap);validateAnchors(targetMap);
  const sr=pcm.sampleRate,length=Math.ceil(duration*sr),out=pcm.channels.map(()=>new Float32Array(length));
  const weights=new Float32Array(length);
  const qs=conformKnots(score,sourceMap,targetMap,manualAnchors),qStart=qs[0],qEnd=qs.at(-1)!;
  for(let k=0;k<qs.length-1;k++){
    const a=qToSeconds(qs[k],sourceMap),b=qToSeconds(qs[k+1],sourceMap);
    const x=qToSeconds(qs[k],targetMap),y=qToSeconds(qs[k+1],targetMap);
    if(b<=a||y<=x)continue;
    const ratio=(b-a)/(y-x);
    if(ratio<.25||ratio>4)throw Error('对齐速度变化过大，请校正锚点 / Alignment has an extreme tempo change');
    const pad=.015,start=Math.max(0,a-pad*ratio),end=Math.min(pcm.channels[0].length/sr,b+pad*ratio);
    const rendered=stretchAudio(slicePCM(pcm,start,end),ratio);
    const outputStart=x-(a-start)/ratio,offset=Math.round(outputStart*sr);
    for(let i=0;i<rendered.channels[0].length;i++){
      const dest=offset+i;if(dest<0||dest>=length)continue;
      const t=outputStart+i/sr;
      const weight=Math.min(1,Math.max(0,(t-outputStart)/pad),Math.max(0,(outputStart+rendered.channels[0].length/sr-t)/pad));
      weights[dest]+=weight;
      for(let c=0;c<out.length;c++)out[c][dest]+=rendered.channels[c][i]*weight;
    }
  }
  // Preserve unmapped prelude/outro with the nearest boundary's offset.
  const firstSource=qToSeconds(qStart,sourceMap),firstTarget=qToSeconds(qStart,targetMap);
  const lastSource=qToSeconds(qEnd,sourceMap),lastTarget=qToSeconds(qEnd,targetMap);
  for(let i=0;i<length;i++){
    if(weights[i]>0){for(const ch of out)ch[i]/=weights[i];continue;}
    const t=i/sr,source=t<firstTarget?t+firstSource-firstTarget:t>=lastTarget?t+lastSource-lastTarget:-1;
    if(source>=0){const j=Math.round(source*sr);for(let c=0;c<out.length;c++)out[c][i]=pcm.channels[c][j]||0;}
  }
  return {sampleRate:sr,channels:out};
}
