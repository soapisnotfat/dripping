import type {Clip,Selection,Track} from './types';

// Keep the playback cursor inside the useful lane area, excluding sticky labels.
export function timelineFollowLeft(positionPixels:number,scrollLeft:number,viewportWidth:number,contentWidth:number,labelWidth=190):number{
  const visible=Math.max(1,viewportWidth-labelWidth);
  if(positionPixels>=scrollLeft&&positionPixels<=scrollLeft+visible*.8)return scrollLeft;
  return Math.max(0,Math.min(contentWidth-viewportWidth,positionPixels-visible*.25));
}
// A timeline range belongs to one visible audio region, including its track offset.
export function clipSelection(track:Track,clip:Clip):Selection{
  const from=Math.max(0,clip.start+track.offset),to=Math.max(from,clip.end+track.offset);
  return {start:from,end:to,trackId:track.id,clipId:clip.id};
}
