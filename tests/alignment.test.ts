// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { audioFeatures, alignToScore, alignToDemo } from '../src/lib/alignment';
import { demoPCM, demoXml } from '../src/lib/demo';
import { parseScore } from '../src/lib/score';
import { mono } from '../src/lib/audio';
import { qToSeconds, tempoMap } from '../src/lib/time';

describe('automatic content-based audio alignment', () => {
  it('matches a melody demonstration and a backing track with different leading silence', () => {
    const score = parseScore(demoXml()),
      audio = demoPCM();
    const demo = audioFeatures(mono(audio.demo), 11025, 0.1),
      backing = audioFeatures(mono(audio.backing), 11025, 0.1);
    const alignedDemo = alignToScore(score, demo),
      alignedBacking = alignToDemo(score, demo, alignedDemo.anchors, backing),
      truth = tempoMap(score);
    const points = [8, 12, 28, 36, 44, 52];
    const demoErrors = points.map((q) =>
      Math.abs(qToSeconds(q, alignedDemo.anchors) - qToSeconds(q, truth) - 0.55),
    );
    const backingErrors = points.map((q) =>
      Math.abs(qToSeconds(q, alignedBacking.anchors) - qToSeconds(q, truth) - 0.2),
    );
    console.log('Synthetic alignment max errors (seconds)', {
      demo: Math.max(...demoErrors),
      backing: Math.max(...backingErrors),
      cost: alignedDemo.cost,
    });
    expect(Math.max(...demoErrors)).toBeLessThan(0.35);
    expect(Math.max(...backingErrors)).toBeLessThan(0.45);
    expect(alignedDemo.status).toBe('candidate');
  });
  it('does not silently mark unrelated or silent audio as accepted', () => {
    const score = parseScore(demoXml()),
      features = audioFeatures(new Float32Array(11025 * 40));
    const result = alignToScore(score, features);
    expect(result.status).toBe('candidate');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
