import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../lib/types';

export function ScoreTempo({
  bpm,
  missing,
  disabled,
  locale,
  onTempo,
}: {
  bpm: number;
  missing: boolean;
  disabled: boolean;
  locale: Locale;
  onTempo: (bpm: number) => void;
}) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const [draft, setDraft] = useState(missing ? '' : String(bpm));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    focused = useRef(false),
    latest = useRef({ disabled, onTempo });
  latest.current = { disabled, onTempo };
  const submit = (value: string) => {
    clearTimeout(timer.current);
    const next = Number(value);
    if (
      !latest.current.disabled &&
      value.trim() &&
      Number.isInteger(next) &&
      next >= 20 &&
      next <= 400
    )
      latest.current.onTempo(next);
  };
  useEffect(() => {
    if (!focused.current) setDraft(missing ? '' : String(bpm));
  }, [bpm, missing]);
  useEffect(() => {
    if (disabled) clearTimeout(timer.current);
    return () => clearTimeout(timer.current);
  }, [disabled]);
  const invalid =
    draft !== '' && (!Number.isInteger(Number(draft)) || Number(draft) < 20 || Number(draft) > 400);
  return (
    <div className="score-tempo">
      <label>
        {t('谱面速度 ♩ =', 'Score tempo ♩ =')}{' '}
        <input
          aria-label={t('谱面速度 BPM', 'Score tempo BPM')}
          type="number"
          min="20"
          max="400"
          step="1"
          value={draft}
          disabled={disabled}
          aria-describedby={missing || invalid ? 'score-tempo-help' : undefined}
          onFocus={() => {
            focused.current = true;
          }}
          onChange={(event) => {
            const value = event.target.value;
            setDraft(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => submit(value), 350);
          }}
          onBlur={() => {
            focused.current = false;
            submit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit(draft);
            }
          }}
        />
      </label>
      {(missing || invalid) && (
        <span id="score-tempo-help">
          {invalid
            ? t('请输入 20–400 BPM。', 'Enter 20–400 BPM.')
            : t(
                '输入谱面速度后即可开始练习或录音。',
                'Enter score tempo to start practice or recording.',
              )}
        </span>
      )}
    </div>
  );
}
