// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Timeline } from '../src/components/Timeline';
import { newProject } from '../src/lib/storage';
import type { Track } from '../src/lib/types';

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render(mixLocked: boolean) {
  const project = newProject('Recording mix'),
    onTrack = vi.fn();
  project.tracks = ['Backing', 'Take'].map((name, index): Track => ({
    id: name,
    name,
    role: index ? 'recording' : 'backing',
    clips: [],
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    offset: 0,
    color: index,
  }));
  act(() =>
    root.render(
      <Timeline
        project={project}
        position={1}
        locale="en"
        scale={100}
        snap
        follow={false}
        waveforms={new Map()}
        recording
        playing
        counting={false}
        locked
        mixLocked={mixLocked}
        armedTrackId="Take"
        activeRecording={{ trackId: 'Take', start: 0 }}
        onArm={() => {}}
        onSeek={() => {}}
        onSelect={() => {}}
        onTrack={onTrack}
        onTrim={() => {}}
        onContext={() => {}}
        onFollow={() => {}}
        onTrackSettings={() => {}}
      />,
    ),
  );
  return onTrack;
}

it('allows live mix controls during recording while keeping track settings and arming locked', () => {
  const onTrack = render(false);
  for (const name of ['Backing', 'Take']) {
    const mute = document.querySelector<HTMLButtonElement>(`[aria-label="Mute ${name}"]`)!,
      solo = document.querySelector<HTMLButtonElement>(`[aria-label="Solo ${name}"]`)!,
      volume = document.querySelector<HTMLInputElement>(`[aria-label="${name} volume"]`)!;
    expect(mute.disabled).toBe(false);
    expect(solo.disabled).toBe(false);
    expect(volume.disabled).toBe(false);
    act(() => mute.click());
    expect(onTrack).toHaveBeenLastCalledWith(name, { mute: true });
    act(() => solo.click());
    expect(onTrack).toHaveBeenLastCalledWith(name, { solo: true });
  }
  expect(
    document.querySelector<HTMLButtonElement>('[aria-label="Arm recording Take"]')!.disabled,
  ).toBe(true);
  for (const settings of document.querySelectorAll<HTMLButtonElement>('[title="Track settings"]'))
    expect(settings.disabled).toBe(true);
});

it('locks live mix controls while recording is being prepared or saved', () => {
  const onTrack = render(true);
  for (const name of ['Backing', 'Take']) {
    const mute = document.querySelector<HTMLButtonElement>(`[aria-label="Mute ${name}"]`)!,
      solo = document.querySelector<HTMLButtonElement>(`[aria-label="Solo ${name}"]`)!,
      volume = document.querySelector<HTMLInputElement>(`[aria-label="${name} volume"]`)!;
    expect(mute.disabled).toBe(true);
    expect(solo.disabled).toBe(true);
    expect(volume.disabled).toBe(true);
    act(() => {
      mute.click();
      solo.click();
    });
  }
  expect(onTrack).not.toHaveBeenCalled();
});
