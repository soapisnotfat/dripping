import type {Track} from './types';

export function audibleTrackIds(tracks:Track[]):string[]{
  const solo=tracks.some(track=>track.solo);
  return tracks.filter(track=>track.clips.length&&!track.mute&&(!solo||track.solo)).map(track=>track.id);
}
