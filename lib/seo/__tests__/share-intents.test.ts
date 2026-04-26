// M14 Unit 4: share-intent URL builders.

import { describe, expect, it } from 'vitest';

import {
  facebookIntent,
  linkedinIntent,
  redditIntent,
  twitterIntent,
} from '../share-intents';

const URL_TEST = 'https://threditor.vercel.app/skin/019dbb09';
const TEXT_TEST = 'Shaded Hoodie by ryanssareen — a classic Minecraft skin';
const TITLE_TEST = 'Shaded Hoodie';

describe('twitterIntent', () => {
  const out = twitterIntent({ text: TEXT_TEST, url: URL_TEST });

  it('starts with Twitter intent endpoint', () => {
    expect(out).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?/);
  });

  it('round-trips url via decodeURIComponent', () => {
    const parsed = new URL(out);
    expect(parsed.searchParams.get('url')).toBe(URL_TEST);
  });

  it('round-trips text via decodeURIComponent', () => {
    const parsed = new URL(out);
    expect(parsed.searchParams.get('text')).toBe(TEXT_TEST);
  });
});

describe('facebookIntent', () => {
  const out = facebookIntent({ url: URL_TEST });

  it('starts with Facebook sharer endpoint', () => {
    expect(out).toMatch(/^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?/);
  });

  it('uses `u=` param (Facebook convention, not `url=`)', () => {
    const parsed = new URL(out);
    expect(parsed.searchParams.get('u')).toBe(URL_TEST);
  });
});

describe('redditIntent', () => {
  const out = redditIntent({ url: URL_TEST, title: TITLE_TEST });

  it('starts with reddit submit endpoint', () => {
    expect(out).toMatch(/^https:\/\/www\.reddit\.com\/submit\?/);
  });

  it('round-trips both url and title', () => {
    const parsed = new URL(out);
    expect(parsed.searchParams.get('url')).toBe(URL_TEST);
    expect(parsed.searchParams.get('title')).toBe(TITLE_TEST);
  });
});

describe('linkedinIntent', () => {
  const out = linkedinIntent({ url: URL_TEST });

  it('starts with linkedin share-offsite endpoint', () => {
    expect(out).toMatch(
      /^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?/,
    );
  });

  it('round-trips url', () => {
    const parsed = new URL(out);
    expect(parsed.searchParams.get('url')).toBe(URL_TEST);
  });
});

describe('special-character handling', () => {
  it('handles names with spaces, #, &, and emoji', () => {
    const nastyText = 'Hoodie & #Hype 🎨 (special)';
    const out = twitterIntent({ text: nastyText, url: URL_TEST });
    const parsed = new URL(out);
    expect(parsed.searchParams.get('text')).toBe(nastyText);
  });

  it('does not double-encode already-encoded characters', () => {
    // If the input text contains a literal `%20`, it should be treated
    // as three characters (%, 2, 0), not as an encoded space.
    const text = 'foo%20bar';
    const out = twitterIntent({ text, url: URL_TEST });
    const parsed = new URL(out);
    expect(parsed.searchParams.get('text')).toBe('foo%20bar');
  });
});
