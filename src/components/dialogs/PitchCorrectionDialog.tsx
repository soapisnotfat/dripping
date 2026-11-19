import { useState } from 'react';
import type { Locale } from '../../lib/types';
import type { WrittenPitch } from '../../lib/score';
import { Modal } from './Modal';

export function PitchCorrectionDialog({
  initial,
  measure,
  locale,
  onApply,
  onClose,
}: {
  initial: WrittenPitch;
  measure: string;
  locale: Locale;
  onApply: (pitch: WrittenPitch) => void;
  onClose: () => void;
}) {
  const t = (zh: string, en: string) => (locale === 'zh' ? zh : en);
  const [pitch, setPitch] = useState(initial);
  const [error, setError] = useState('');
  const marks = [
    t('重降', 'Double flat'),
    t('降', 'Flat'),
    t('还原', 'Natural'),
    t('升', 'Sharp'),
    t('重升', 'Double sharp'),
  ];
  const changed =
    pitch.step !== initial.step || pitch.alter !== initial.alter || pitch.octave !== initial.octave;
  return (
    <Modal title={t('校正音高', 'Correct pitch')} onClose={onClose}>
      <form
        className="pitch-correction"
        onSubmit={(event) => {
          event.preventDefault();
          if (!changed) return;
          try {
            onApply(pitch);
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        }}
      >
        <p>{t(`第 ${measure} 小节`, `Measure ${measure}`)}</p>
        <div className="pitch-correction-fields">
          <label>
            {t('音名', 'Note')}
            <select
              data-dialog-autofocus
              value={pitch.step}
              onChange={(event) => setPitch({ ...pitch, step: event.target.value })}
            >
              {Array.from('CDEFGAB').map((step) => (
                <option key={step}>{step}</option>
              ))}
            </select>
          </label>
          <label>
            {t('变音记号', 'Accidental')}
            <select
              value={pitch.alter}
              onChange={(event) => setPitch({ ...pitch, alter: Number(event.target.value) })}
            >
              {marks.map((mark, index) => (
                <option value={index - 2} key={mark}>
                  {mark}
                </option>
              ))}
              {(!Number.isInteger(initial.alter) || Math.abs(initial.alter) > 2) && (
                <option value={initial.alter}>{initial.alter}</option>
              )}
            </select>
          </label>
          <label>
            {t('八度', 'Octave')}
            <select
              value={pitch.octave}
              onChange={(event) => setPitch({ ...pitch, octave: Number(event.target.value) })}
            >
              {Array.from({ length: 10 }, (_, octave) => (
                <option key={octave} value={octave}>
                  {octave}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="submit" className="primary" disabled={!changed}>
            {t('应用校正', 'Apply correction')}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
