/**
 * Responsive helpers for the Unsplash photos used in the portal. The picture itself (crop, quality 85) is unchanged;
 * we only let the browser pick a smaller width of the same photo when the screen is small, so phones download
 * a fraction of the bytes and the images appear much faster.
 */
const WIDTHS = [320, 480, 640, 800, 1000, 1200];

const isUnsplash = (url: string) => /^https:\/\/images\.unsplash\.com\//.test(url);

const withWidth = (url: string, w: number) => (/([?&])w=\d+/.test(url) ? url.replace(/([?&])w=\d+/, `$1w=${w}`) : `${url}${url.includes('?') ? '&' : '?'}w=${w}`);

/** srcSet for an image, capped at the original width. Returns undefined for non-Unsplash images. */
export function photoSrcSet(url: string | undefined): string | undefined {
  if (!url || !isUnsplash(url)) return undefined;
  const max = Number(/[?&]w=(\d+)/.exec(url)?.[1] || 1200);
  return WIDTHS.filter((w) => w <= max).map((w) => `${withWidth(url, w)} ${w}w`).join(', ');
}

/** Warm the browser cache with the next photo so a slide change never shows an empty frame. */
export function prefetchPhoto(url: string | undefined, sizeHint = 800) {
  if (!url || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  const set = photoSrcSet(url);
  if (set) img.srcset = set;
  img.sizes = `${sizeHint}px`;
  img.src = url;
}
