// CC0 surface textures (ambientCG), served from client/public/tex/. NOT wired in yet: phase 2 decides.
//
// Two kinds of map:
//  - 'color'  : albedo, use as-is (wood rim, leather).
//  - 'detail' : greyscale, mean-centred at 50 % grey. Lay it over the existing procedural colour with
//               globalCompositeOperation 'overlay' / 'soft-light' at alpha 0.08–0.25 (canvas), or CSS
//               `background-blend-mode: soft-light` / `mix-blend-mode: overlay`. Mid-grey = no change, so
//               the palette in palette.ts stays in charge and the texture only adds grain.
//
// Where each would plug in (suggested, see docs/ASSETS.md):
//  felt          → mat.ts weaveTile(): replace the synthetic weave with `pattern('felt')`, drawn at
//                  ~0.10 alpha in 'soft-light' over matBackdrop (world space so it pans with the board).
//  wood-dark     → mat.ts / theme.css: a table rim past the mat edge (CSS `border-image` or a canvas frame
//                  under lampOverlay's vignette); also the bottom order-strip tray background.
//  metal-brushed → plates.ts gunmetal(): after the gradient fill, `overlayDetail(g, 'metal-brushed', …, 0.12)`
//                  clipped to the plate path; theme.css chrome (.panel / top bar) via `cssUrl()`.
//  metal-worn    → plates.ts enamel() rims ('gold' / 'iron') at 0.15 for tarnish; brass buttons.
//  parchment     → ui/herald.ts sheet: theme.css `.herald` background-image with soft-light over the
//                  current beige gradient (alpha via a pseudo-element at opacity .35).
//  leather       → modal backs / the Fate token tray / card spines (CSS background, `background-size: 256px`).
export type TexName = 'felt' | 'wood-dark' | 'metal-brushed' | 'metal-worn' | 'parchment' | 'leather';

export const TEXTURES: Record<TexName, { file: string; size: number; kind: 'color' | 'detail' }> = {
  'felt':          { file: 'felt.webp', size: 512, kind: 'detail' },
  'wood-dark':     { file: 'wood-dark.webp', size: 1024, kind: 'color' },
  'metal-brushed': { file: 'metal-brushed.webp', size: 512, kind: 'detail' },
  'metal-worn':    { file: 'metal-worn.webp', size: 512, kind: 'detail' },
  'parchment':     { file: 'parchment.webp', size: 1024, kind: 'detail' },
  'leather':       { file: 'leather.webp', size: 512, kind: 'color' },
};

const BASE = 'tex/';
const cache = new Map<TexName, Promise<HTMLImageElement | null>>();
const ready = new Map<TexName, HTMLImageElement>();

/** Absolute URL of a texture (for CSS: `url(${texUrl('parchment')})`). */
export function texUrl(name: TexName): string {
  try { return new URL(BASE + TEXTURES[name].file, document.baseURI).href; } catch { return BASE + TEXTURES[name].file; }
}
/** CSS value `url("…")`. */
export const cssUrl = (name: TexName) => `url("${texUrl(name)}")`;

/** Load (cached). Resolves null if the image fails, so callers can keep the procedural fallback. */
export function loadTexture(name: TexName): Promise<HTMLImageElement | null> {
  const hit = cache.get(name);
  if (hit) return hit;
  const p = new Promise<HTMLImageElement | null>((res) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { ready.set(name, img); res(img); };
    img.onerror = () => res(null);
    img.src = texUrl(name);
  });
  cache.set(name, p);
  return p;
}
/** Load several (default: all). */
export function preloadTextures(names: TexName[] = Object.keys(TEXTURES) as TexName[]): Promise<(HTMLImageElement | null)[]> {
  return Promise.all(names.map(loadTexture));
}
/** The image if already decoded, else null (and starts the load) — for synchronous canvas painters. */
export function textureNow(name: TexName): HTMLImageElement | null {
  const img = ready.get(name);
  if (!img) void loadTexture(name);
  return img ?? null;
}

/** A repeating canvas pattern, optionally scaled (e.g. 0.5 = finer grain). Null until loaded. */
export function pattern(g: CanvasRenderingContext2D, name: TexName, scale = 1): CanvasPattern | null {
  const img = textureNow(name);
  if (!img) return null;
  const p = g.createPattern(img, 'repeat');
  if (p && scale !== 1 && typeof DOMMatrix !== 'undefined') p.setTransform(new DOMMatrix().scale(scale));
  return p;
}

/**
 * Lay a detail map over whatever is already drawn in (x, y, w, h), keeping the palette: soft-light at low
 * alpha. Clip to a path first for shaped plates. No-op until the texture has loaded.
 */
export function overlayDetail(
  g: CanvasRenderingContext2D, name: TexName, x: number, y: number, w: number, h: number,
  alpha = 0.15, mode: GlobalCompositeOperation = 'soft-light', scale = 1,
): boolean {
  const p = pattern(g, name, scale);
  if (!p) return false;
  g.save();
  g.globalAlpha = alpha;
  g.globalCompositeOperation = mode;
  g.fillStyle = p;
  g.fillRect(x, y, w, h);
  g.restore();
  return true;
}
