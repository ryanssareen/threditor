// @vitest-environment node
//
// M17 Stage 1 — Groq clarifier validator unit tests.
//
// Tests the pure synchronous helper `validateClarification`. The
// async SDK call path is covered by integration tests against the
// route; here we focus on shape contract enforcement and
// sanitization (clamping overlong fields, deduping, drops, etc.).

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { GroqValidationError } from '../groq';
import { validateClarification } from '../groq-clarifier';

describe('validateClarification', () => {
  it('accepts a clean { needsClarification: false } object', () => {
    const result = validateClarification({ needsClarification: false }, 'stop');
    expect(result.needsClarification).toBe(false);
    expect(result.questions).toBeUndefined();
  });

  it('accepts a fully-formed clarification with single_select', () => {
    const result = validateClarification(
      {
        needsClarification: true,
        questions: [
          {
            id: 'style',
            question: 'What art style?',
            options: ['Pixel art', 'Cartoon', 'Realistic'],
            type: 'single_select',
          },
        ],
      },
      'stop',
    );
    expect(result.needsClarification).toBe(true);
    expect(result.questions).toHaveLength(1);
    expect(result.questions?.[0].id).toBe('style');
    expect(result.questions?.[0].type).toBe('single_select');
    expect(result.questions?.[0].options).toEqual(['Pixel art', 'Cartoon', 'Realistic']);
  });

  it('defaults missing/invalid type to single_select', () => {
    const result = validateClarification(
      {
        needsClarification: true,
        questions: [
          { id: 'q1', question: 'Pick one', options: ['A', 'B'] },
          { id: 'q2', question: 'Pick many', options: ['X', 'Y'], type: 'unknown' },
        ],
      },
      'stop',
    );
    expect(result.questions).toHaveLength(2);
    expect(result.questions?.[0].type).toBe('single_select');
    expect(result.questions?.[1].type).toBe('single_select');
  });

  it('preserves multi_select when explicitly typed', () => {
    const result = validateClarification(
      {
        needsClarification: true,
        questions: [
          {
            id: 'accessories',
            question: 'Which accessories?',
            options: ['Helmet', 'Cape', 'Sword'],
            type: 'multi_select',
          },
        ],
      },
      'stop',
    );
    expect(result.questions?.[0].type).toBe('multi_select');
  });

  it('throws when needsClarification=true but questions is missing or empty', () => {
    expect(() =>
      validateClarification({ needsClarification: true }, 'stop'),
    ).toThrow(GroqValidationError);
    expect(() =>
      validateClarification({ needsClarification: true, questions: [] }, 'stop'),
    ).toThrow(GroqValidationError);
  });

  it('throws on null / array / non-object input', () => {
    expect(() => validateClarification(null, 'stop')).toThrow(GroqValidationError);
    expect(() => validateClarification([], 'stop')).toThrow(GroqValidationError);
    expect(() => validateClarification(42, 'stop')).toThrow(GroqValidationError);
    expect(() => validateClarification('hi', 'stop')).toThrow(GroqValidationError);
  });

  it('throws when needsClarification is not a boolean', () => {
    expect(() =>
      validateClarification({ needsClarification: 'yes' as unknown as boolean }, 'stop'),
    ).toThrow(GroqValidationError);
  });

  it('drops malformed individual questions but keeps valid ones', () => {
    const result = validateClarification(
      {
        needsClarification: true,
        questions: [
          { id: 'good', question: 'Pick one', options: ['A', 'B'] },
          // missing question
          { id: 'bad1', options: ['A', 'B'] },
          // options not an array
          { id: 'bad2', question: 'No opts', options: 'A,B' },
          // only 1 option (below MIN_OPTIONS=2)
          { id: 'bad3', question: 'Alone', options: ['Only'] },
        ],
      },
      'stop',
    );
    expect(result.questions).toHaveLength(1);
    expect(result.questions?.[0].id).toBe('good');
  });

  it('throws when no valid question survives sanitization', () => {
    expect(() =>
      validateClarification(
        {
          needsClarification: true,
          questions: [
            { id: 'bad', options: ['only-one'] },
            { id: 'bad2', question: 42, options: ['A', 'B'] },
          ],
        },
        'stop',
      ),
    ).toThrow(GroqValidationError);
  });

  it('caps to 5 questions max, takes the first 5', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `q${i}`,
      question: `Question ${i}?`,
      options: ['A', 'B'],
    }));
    const result = validateClarification(
      { needsClarification: true, questions: many },
      'stop',
    );
    expect(result.questions?.length).toBe(5);
    expect(result.questions?.[0].id).toBe('q0');
    expect(result.questions?.[4].id).toBe('q4');
  });

  it('caps options to 6 per question and dedupes', () => {
    const result = validateClarification(
      {
        needsClarification: true,
        questions: [
          {
            id: 'styles',
            question: 'Pick one',
            options: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'A'],
          },
        ],
      },
      'stop',
    );
    expect(result.questions?.[0].options.length).toBe(6);
    expect(result.questions?.[0].options).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('skips duplicate question ids', () => {
    const result = validateClarification(
      {
        needsClarification: true,
        questions: [
          { id: 'style', question: 'First', options: ['A', 'B'] },
          { id: 'style', question: 'Second', options: ['C', 'D'] },
        ],
      },
      'stop',
    );
    expect(result.questions?.length).toBe(1);
    expect(result.questions?.[0].question).toBe('First');
  });

  it('clamps overlong question/option text', () => {
    const result = validateClarification(
      {
        needsClarification: true,
        questions: [
          {
            id: 'a'.repeat(100),
            question: 'q'.repeat(500),
            options: ['x'.repeat(200), 'y'.repeat(50)],
          },
        ],
      },
      'stop',
    );
    expect(result.questions?.[0].id.length).toBeLessThanOrEqual(40);
    expect(result.questions?.[0].question.length).toBeLessThanOrEqual(200);
    expect(result.questions?.[0].options[0].length).toBeLessThanOrEqual(60);
  });
});
