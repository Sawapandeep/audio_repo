const allowedHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

export function validateSourceUrl(input: unknown): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error('A YouTube or YouTube Music URL is required.');
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('That is not a valid URL.'); }
  if (url.protocol !== 'https:') throw new Error('Only HTTPS YouTube URLs are allowed.');
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error('Only YouTube and YouTube Music URLs are supported.');
  if (url.hostname.endsWith('youtu.be') && !url.pathname.slice(1)) throw new Error('The YouTube short URL is missing a video id.');
  if (url.hostname.includes('youtube.com') && !['/watch','/playlist','/shorts','/embed'].some(p=>url.pathname.startsWith(p)) && !url.pathname.startsWith('/music')) {
    throw new Error('Unsupported YouTube URL type.');
  }
  return url.toString();
}
