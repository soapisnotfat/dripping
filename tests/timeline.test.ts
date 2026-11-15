import {expect,it} from 'vitest';
import {timelineFollowLeft} from '../src/lib/timeline';

it('holds the viewport while the cursor is comfortably visible, then leaves room ahead',()=>{
  expect(timelineFollowLeft(400,0,1000,3000)).toBe(0);
  const left=timelineFollowLeft(700,0,1000,3000),cursorX=190+700-left;
  expect(left).toBeGreaterThan(0);
  expect(cursorX).toBeGreaterThan(190);expect(cursorX).toBeLessThan(800);
  // A smooth scroll already heading here should not be restarted on every frame.
  expect(timelineFollowLeft(710,left,1000,3000)).toBe(left);
});
it('returns to the start on backward seeks, respects the end, and follows on narrow screens',()=>{
  expect(timelineFollowLeft(0,800,1000,3000)).toBe(0);
  expect(timelineFollowLeft(2750,0,1000,3000)).toBe(2000);
  const left=timelineFollowLeft(170,0,390,3000);
  expect(190+170-left).toBeGreaterThan(190);expect(190+170-left).toBeLessThan(390);
});
