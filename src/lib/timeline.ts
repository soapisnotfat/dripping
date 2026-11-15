// Keep the playback cursor inside the useful lane area, excluding sticky labels.
export function timelineFollowLeft(positionPixels:number,scrollLeft:number,viewportWidth:number,contentWidth:number,labelWidth=190):number{
  const visible=Math.max(1,viewportWidth-labelWidth);
  if(positionPixels>=scrollLeft&&positionPixels<=scrollLeft+visible*.8)return scrollLeft;
  return Math.max(0,Math.min(contentWidth-viewportWidth,positionPixels-visible*.25));
}
