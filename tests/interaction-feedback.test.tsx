// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DraftNumber } from '../src/components/DraftNumber';
import { Modal } from '../src/components/Dialogs';

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const field = () => document.querySelector('input')!;
const fill = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });

it('focuses a dialog on entry and restores its trigger on close', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  act(() =>
    root.render(
      <Modal title="Test" onClose={() => {}}>
        <input />
      </Modal>,
    ),
  );
  expect(document.activeElement?.closest('[role=dialog]')).not.toBeNull();
  act(() => root.render(null));
  expect(document.activeElement).toBe(trigger);
});

it('preserves a child autofocus field while still restoring the dialog trigger', () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  act(() =>
    root.render(
      <Modal title="Test" onClose={() => {}}>
        <input autoFocus />
      </Modal>,
    ),
  );
  expect(document.activeElement).toBe(field());
  act(() => root.render(null));
  expect(document.activeElement).toBe(trigger);
});

it('returns focus to the persistent project control when the original trigger was removed', () => {
  const fallback = document.createElement('button');
  fallback.dataset.modalFocusFallback = '';
  document.body.append(fallback);
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  act(() =>
    root.render(
      <Modal title="Test" onClose={() => {}}>
        <input />
      </Modal>,
    ),
  );
  trigger.remove();
  act(() => root.render(null));
  expect(document.activeElement).toBe(fallback);
});

it('keeps numeric edits as drafts until blur or Enter and rejects empty/out-of-range values', () => {
  const onCommit = vi.fn();
  act(() =>
    root.render(
      <DraftNumber
        value={40}
        min={-500}
        max={1000}
        label="Latency"
        invalidText="Enter a whole number"
        onCommit={onCommit}
      />,
    ),
  );
  act(() => field().focus());
  fill('');
  act(() => field().blur());
  expect(onCommit).not.toHaveBeenCalled();
  expect(field().value).toBe('');
  expect(document.querySelector('[role=alert]')).not.toBeNull();
  act(() => field().focus());
  fill('1001');
  act(() => field().blur());
  expect(onCommit).not.toHaveBeenCalled();
  act(() => field().focus());
  fill('-12');
  expect(onCommit).not.toHaveBeenCalled();
  act(() => field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(-12);
});

it('commits fractional track offsets on blur without resetting the input while typing', () => {
  const onCommit = vi.fn();
  act(() =>
    root.render(
      <DraftNumber
        value={0}
        step={0.125}
        label="Offset"
        invalidText="Use eighth beats"
        onCommit={onCommit}
      />,
    ),
  );
  act(() => field().focus());
  fill('1.125');
  expect(onCommit).not.toHaveBeenCalled();
  expect(field().value).toBe('1.125');
  act(() => field().blur());
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(1.125);
});
