// @vitest-environment node
//
// M17 Stage 1 — Groq interpreter unit tests.
//
// We exercise:
//   - validateParts: shape contract enforcement (the pure synchronous
//     helper, no SDK involvement)
//   - composeRenderPrompt: deterministic prompt composition,
//     overlay handling, length cap

import { describe, expect, it } from 'vitest';

// `groq-interpreter.ts` imports `groq.ts` which imports `'server-only'`.
// Stub it so tests can require the module without an explicit
// transformer. Mirrors the pattern in `cloudflare-client.test.ts`.
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { GroqValidationError } from '../groq';
import {
  buildUserMessage,
  composeRenderPrompt,
  validateParts,
} from '../groq-interpreter';
import type { SkinPartDescriptions } from '../types';

const VALID_PARTS: SkinPartDescriptions = {
  head: 'pale skin, red short hair, sad blue eyes with tears, freckles',
  torso: 'red and silver chest plate with gold trim, white tunic at waist',
  rightArm: 'red armored sleeve, silver shoulder guard, gauntlet',
  leftArm: 'red armored sleeve, silver shoulder guard, gauntlet',
  rightLeg: 'dark blue cloth pants, red armor plate on shin, brown boot',
  leftLeg: 'dark blue cloth pants, red armor plate on shin, brown boot',
  variant: 'classic',
};

describe('validateParts', () => {
  it('accepts a fully valid SkinPartDescriptions object', () => {
    const result = validateParts(VALID_PARTS, 'stop');
    expect(result.head).toBe(VALID_PARTS.head);
    expect(result.variant).toBe('classic');
    expect(result.headOverlay).toBeUndefined();
    expect(result.torsoOverlay).toBeUndefined();
  });

  it('preserves overlay fields when non-empty', () => {
    const result = validateParts(
      {
        ...VALID_PARTS,
        headOverlay: 'silver knight helmet with red plume',
        torsoOverlay: 'red wool cape',
      },
      'stop',
    );
    expect(result.headOverlay).toBe('silver knight helmet with red plume');
    expect(result.torsoOverlay).toBe('red wool cape');
  });

  it('drops overlay fields that are empty / whitespace / "none"', () => {
    const empty = validateParts(
      { ...VALID_PARTS, headOverlay: '', torsoOverlay: '   ' },
      'stop',
    );
    expect(empty.headOverlay).toBeUndefined();
    expect(empty.torsoOverlay).toBeUndefined();

    const sentinels = validateParts(
      { ...VALID_PARTS, headOverlay: 'none', torsoOverlay: 'N/A' },
      'stop',
    );
    expect(sentinels.headOverlay).toBeUndefined();
    expect(sentinels.torsoOverlay).toBeUndefined();
  });

  it('lowercases and validates variant', () => {
    const upper = validateParts({ ...VALID_PARTS, variant: 'CLASSIC' }, 'stop');
    expect(upper.variant).toBe('classic');
    const slim = validateParts({ ...VALID_PARTS, variant: 'Slim' }, 'stop');
    expect(slim.variant).toBe('slim');
  });

  it('rejects invalid variant values', () => {
    expect(() =>
      validateParts({ ...VALID_PARTS, variant: 'tall' }, 'stop'),
    ).toThrow(GroqValidationError);
  });

  it('rejects when required field is missing or empty', () => {
    const missingHead = { ...VALID_PARTS } as Record<string, unknown>;
    delete missingHead.head;
    expect(() => validateParts(missingHead, 'stop')).toThrow(GroqValidationError);

    expect(() =>
      validateParts({ ...VALID_PARTS, torso: '   ' }, 'stop'),
    ).toThrow(GroqValidationError);

    expect(() =>
      validateParts({ ...VALID_PARTS, leftLeg: 42 as unknown as string }, 'stop'),
    ).toThrow(GroqValidationError);
  });

  it('rejects null / array / non-object input', () => {
    expect(() => validateParts(null, 'stop')).toThrow(GroqValidationError);
    expect(() => validateParts([], 'stop')).toThrow(GroqValidationError);
    expect(() => validateParts('hello', 'stop')).toThrow(GroqValidationError);
    expect(() => validateParts(42, 'stop')).toThrow(GroqValidationError);
  });

  it('clamps absurdly long fields to a reasonable max length', () => {
    const huge = 'a'.repeat(10_000);
    const result = validateParts({ ...VALID_PARTS, head: huge }, 'stop');
    expect(result.head.length).toBeLessThanOrEqual(600);
  });

  it('trims surrounding whitespace from fields', () => {
    const result = validateParts(
      { ...VALID_PARTS, head: '   pale skin, sad eyes   ' },
      'stop',
    );
    expect(result.head).toBe('pale skin, sad eyes');
  });
});

describe('buildUserMessage', () => {
  it('returns the bare prompt when no answers are provided', () => {
    expect(buildUserMessage('a knight', null)).toBe('a knight');
    expect(buildUserMessage('a knight', {})).toBe('a knight');
  });

  it('appends string answers as `- key: value` lines', () => {
    const result = buildUserMessage('a knight', { style: 'Pixel art', armor: 'Plate' });
    expect(result).toContain('a knight');
    expect(result).toContain('User preferences:');
    expect(result).toContain('- style: Pixel art');
    expect(result).toContain('- armor: Plate');
  });

  it('joins array answers with commas', () => {
    const result = buildUserMessage('a knight', {
      accessories: ['Helmet', 'Cape', 'Sword'],
    });
    expect(result).toContain('- accessories: Helmet, Cape, Sword');
  });

  it('drops empty / whitespace values', () => {
    const result = buildUserMessage('a knight', {
      style: 'Pixel art',
      empty: '',
      blank: '   ',
      emptyArr: [],
    });
    expect(result).toContain('- style: Pixel art');
    expect(result).not.toContain('empty');
    expect(result).not.toContain('blank');
    expect(result).not.toContain('emptyArr');
  });

  it('clamps overlong values', () => {
    const huge = 'x'.repeat(500);
    const result = buildUserMessage('a knight', { style: huge });
    // Single-string values are capped at 80 chars in the rendered line.
    const styleLine = result.split('\n').find((l) => l.startsWith('- style'));
    expect(styleLine).toBeDefined();
    expect((styleLine ?? '').length).toBeLessThanOrEqual(120);
  });

  it('treats arrays as non-string-safe (drops non-string members)', () => {
    const result = buildUserMessage('a knight', {
      mixed: ['Helmet', 42 as unknown as string, 'Cape'],
    });
    expect(result).toContain('- mixed: Helmet, Cape');
    expect(result).not.toContain('42');
  });
});

describe('composeRenderPrompt', () => {
  it('produces a single string anchoring every required region', () => {
    const prompt = composeRenderPrompt(VALID_PARTS);
    expect(prompt).toContain('head:');
    expect(prompt).toContain('torso:');
    expect(prompt).toContain('right arm:');
    expect(prompt).toContain('left arm:');
    expect(prompt).toContain('right leg:');
    expect(prompt).toContain('left leg:');
    expect(prompt).toContain('classic');
  });

  it('omits overlay segments when overlays are absent', () => {
    const prompt = composeRenderPrompt(VALID_PARTS);
    expect(prompt).not.toContain('head accessory');
    expect(prompt).not.toContain('torso outerwear');
  });

  it('includes overlay segments when overlays are present', () => {
    const prompt = composeRenderPrompt({
      ...VALID_PARTS,
      headOverlay: 'silver knight helmet',
      torsoOverlay: 'red cape',
    });
    expect(prompt).toContain('head accessory: silver knight helmet');
    expect(prompt).toContain('torso outerwear: red cape');
  });

  it('honors slim variant', () => {
    const prompt = composeRenderPrompt({ ...VALID_PARTS, variant: 'slim' });
    expect(prompt).toContain('slim');
    expect(prompt).toContain('3px arms');
  });

  it('clamps to a length the worker can validate (≤400 chars)', () => {
    const huge = 'lorem ipsum dolor sit amet '.repeat(50);
    const prompt = composeRenderPrompt({
      ...VALID_PARTS,
      head: huge,
      torso: huge,
      rightArm: huge,
      leftArm: huge,
      rightLeg: huge,
      leftLeg: huge,
    });
    // Worker validates user prompt against PROMPT_MAX_LEN=400 BEFORE
    // adding its own internal prefix, so our composed prompt must
    // stay ≤ 400. We target ≤380 for a safety margin.
    expect(prompt.length).toBeLessThanOrEqual(380);
  });
});
