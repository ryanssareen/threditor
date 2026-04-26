/**
 * M14: pure helpers that build share-intent URLs for each supported
 * platform. Kept pure so tests can assert exact encodings and a single
 * place guarantees `encodeURIComponent` is applied exactly once.
 */

type TextAndUrl = { text: string; url: string };
type UrlOnly = { url: string };
type UrlAndTitle = { url: string; title: string };

export function twitterIntent({ text, url }: TextAndUrl): string {
  const params = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function facebookIntent({ url }: UrlOnly): string {
  const params = new URLSearchParams({ u: url });
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

export function redditIntent({ url, title }: UrlAndTitle): string {
  const params = new URLSearchParams({ url, title });
  return `https://www.reddit.com/submit?${params.toString()}`;
}

export function linkedinIntent({ url }: UrlOnly): string {
  const params = new URLSearchParams({ url });
  return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
}
