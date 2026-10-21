// Icon review sheet (client/src/art/icons.ts): every icon at 14 / 16 / 20 / 32 px text sizes next to sample
// numbers, on the dark chrome and on the Herald's parchment, plus the canvas renderer and glyphHtml() on real
// strings. Bundles icons.ts with esbuild (no dev server needed).
//   node scripts/icon-gallery.mjs [outDir=/tmp/claude-0/icons] [dpr=1]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const esbuild = require('esbuild');
const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = process.argv[2] ?? '/tmp/claude-0/icons';
const dpr = Number(process.argv[3] ?? 1);
mkdirSync(outDir, { recursive: true });

const bundle = await esbuild.build({
  entryPoints: [`${root}client/src/art/icons.ts`], bundle: true, write: false, format: 'iife', globalName: 'Icons', target: 'es2022',
});
const js = bundle.outputFiles[0].text;
const css = readFileSync(`${root}client/src/icons.css`, 'utf8');

// The game's fonts, inlined: headless Chromium does not go through the agent proxy, curl does. Latin subsets
// only, cached next to the screenshots. Without network the sheet falls back to system faces.
function fontCss() {
  const cache = `${outDir}/.fonts.css`;
  if (existsSync(cache)) return readFileSync(cache, 'utf8');
  try {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
    const css = execFileSync('curl', ['-sS', '-m', '20', '-A', ua, 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&family=IM+Fell+English&family=Rajdhani:wght@600;700&display=swap'], { encoding: 'utf8' });
    const blocks = css.split('/* ').filter(b => b.startsWith('latin */'));
    const out = blocks.map(b => {
      const url = /url\((https:[^)]+)\)/.exec(b)[1];
      const data = execFileSync('curl', ['-sS', '-m', '20', url]);
      return '@font-face' + b.slice(b.indexOf('{')).replace(url, `data:font/woff2;base64,${data.toString('base64')}`);
    }).join('\n');
    writeFileSync(cache, out);
    return out;
  } catch (e) { console.warn('fonts unavailable:', e.message); return ''; }
}

const W = 1500;
const page0 = `<!doctype html><html><head><meta charset="utf-8">
<style>${fontCss()}
${css}
body { margin: 0; width: ${W}px; background: #0b0c10; color: #ece3cf; font-family: Rajdhani, system-ui, sans-serif; }
.sheet { padding: 14px 18px; }
.sheet.dark { background: linear-gradient(158deg, #31343e 0%, #1d1f26 42%, #121318 100%); }
.sheet.parch { color: #23190e; font-family: 'IM Fell English', Georgia, serif;
  background: radial-gradient(ellipse at 18% 8%, rgba(255,248,228,.9), rgba(255,248,228,0) 55%), linear-gradient(170deg, #efe4c8 0%, #e2d2ab 60%, #cdb98a 100%); }
h1 { font: 700 18px Cinzel, serif; letter-spacing: .06em; margin: 4px 0 10px; color: #d9b26a; }
.parch h1 { color: #4a2a10; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); column-gap: 18px; }
.cell { display: flex; align-items: center; gap: 12px; height: 46px; border-bottom: 1px solid rgba(214,173,98,.14); white-space: nowrap; }
.parch .cell { border-bottom-color: rgba(90,60,20,.18); }
.nm { width: 74px; font: 600 11px Rajdhani, sans-serif; color: #a89f8c; overflow: hidden; text-overflow: ellipsis; }
.parch .nm { color: #6b5536; }
.s { font-weight: 700; line-height: 1; }
.parch .s { font-family: Cinzel, serif; font-weight: 700; }
.s14 { font-size: 14px; } .s16 { font-size: 16px; } .s20 { font-size: 20px; } .s32 { font-size: 32px; }
.pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; margin: 4px 6px 4px 0; border-radius: 8px; font: 700 20px Rajdhani;
  background: linear-gradient(158deg, #31343e 0%, #1d1f26 42%, #121318 100%); border: 1px solid rgba(201,160,90,.42); }
.pill small { font-size: 12px; color: #7ee3a2; }
.row { margin: 6px 0; font-size: 15px; }
.ink { color: #ffd86b; } .bad { color: #ff6b5e; }
canvas { display: block; }
</style></head><body><div id="root"></div><script>${js}</script></body></html>`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
});
const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.setContent(page0, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

async function shot(name, build, arg) {
  await page.evaluate(build, arg);
  await page.evaluate(() => document.fonts.ready);
  const file = `${outDir}/${name}${dpr !== 1 ? `@${dpr}x` : ''}.png`;
  await page.locator('#root').screenshot({ path: file });
  console.log(file);
}

const names = await page.evaluate(() => Icons.ICON_NAMES);
const PER = 64;
for (const theme of ['dark', 'parch']) {
  for (let i = 0; i * PER < names.length; i++) {
    await shot(`${theme}-${i + 1}`, ([theme, from, to]) => {
      const { ic, ICON_NAMES } = Icons;
      const n = ICON_NAMES.slice(from, to);
      const nums = ['34', '7', '128', '+3'];
      const cells = n.map((k, j) => `<div class="cell"><span class="nm">${k}</span>${[14, 16, 20, 32].map((s, q) => `<span class="s s${s}">${ic(k)}${nums[(j + q) % 4]}</span>`).join('')}</div>`).join('');
      document.getElementById('root').innerHTML = `<div class="sheet ${theme}"><h1>${theme === 'dark' ? 'Chrome' : 'The Herald'} · icons ${from + 1}–${Math.min(to, ICON_NAMES.length)} · 14 / 16 / 20 / 32 px</h1><div class="grid">${cells}</div></div>`;
    }, [theme, i * PER, (i + 1) * PER]);
  }
}

// glyphHtml on real strings + the HUD pills, then the canvas renderer (with halo, as on the map)
await shot('in-context', () => {
  const { ic, glyphHtml, drawIcon, ICON_NAMES } = Icons;
  const lines = [
    '⚙ 35 +32 · ¢ 18 +13 · ✦ 6 +5 · ✪✪✪', '⚔ 61 ❤ 96% ➤ 1 · ⛭ 4', '◇ Steady ⛉ Guarded » Running ⚡ Charge ◉ Ambush',
    '⚑ Levies 🔥 Scorch ⛩ Gates', '⚔ Stand ↻ Twist ⇶ Jump ✚ Rally ⚡ Surge', '☉ ● ✹ ⚭ ✳ ◉ · ◉ ◍ ⁘ ◐ ◌ ⌂ ⬡ · ♚ ⚒ ⚓ ⛯',
    '⛨ 12/14 · ☺ 3/4 · ⚖ 3 · ⛓ 2! · ⚑ 4 · ⊘ locked · ⚠ Enemy near Ninefold', '<b data-tip="⊘ not adjacent">attribute glyphs stay text: ⊘</b> · ×3 stays ×3',
  ];
  const pills = `<span class="pill">${ic('industry', { cls: 'ic-pill ic-brass' })}35<small>+32</small></span><span class="pill">${ic('credits', { cls: 'ic-pill ic-gold' })}18<small>+13</small></span><span class="pill">${ic('influence', { cls: 'ic-pill', color: '#7dffb0' })}6<small>+5</small></span><span class="pill">${['fate', 'fate', 'fate'].map(k => ic(k, { cls: 'ic-pill ic-gold' })).join('')}</span>
    <span class="pill">${ic('attack', { cls: 'ic-pill ic-emboss' })}61 ${ic('hull', { cls: 'ic-pill ic-emboss', color: '#ff8a7a' })}96% ${ic('speed', { cls: 'ic-pill ic-emboss' })}1</span>`;
  document.getElementById('root').innerHTML = `<div class="sheet dark"><h1>glyphHtml() on game strings · pills (ic-pill, emboss)</h1>${pills}${lines.map(l => `<div class="row">${glyphHtml(l)}</div>`).join('')}
    <div class="row" style="font-size:20px">${glyphHtml(lines[0])}</div><h1>Canvas drawIcon() · 14 / 16 / 22 px, halo + number, on a map fill</h1><canvas id="cv"></canvas></div>
    <div class="sheet parch"><h1>Herald</h1><div class="row" style="font: 700 22px Cinzel">${glyphHtml('✝ HOME GUARD FALLS AT MIRE OF AUN · ❖ HONOURED · ⚖ TRIBUTE')}</div><div class="row">${glyphHtml('⤺ Routed · ✠ Blood-debt sworn · ✗ Oath broken · ★ Legend · ♛ Crowned · ⇢ Refugees')}</div></div>`;
  const cv = document.getElementById('cv');
  const dpr = devicePixelRatio, W = 1460, H = 330;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, '#1b2a4a'); grad.addColorStop(0.5, '#3a1a3a'); grad.addColorStop(1, '#2a3a1a');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const sizes = [14, 16, 22];
  ICON_NAMES.forEach((k, i) => {
    const col = i % 27, row = Math.floor(i / 27);
    const s = sizes[row % 3];
    const x = 14 + col * 53, y = 22 + row * 52;
    drawIcon(g, k, x, y, s, '#f6ead0', { halo: 'rgba(5,3,12,0.9)', haloWidth: 2.5, align: 'left' });
    g.font = `700 ${s}px Rajdhani, sans-serif`; g.textBaseline = 'middle'; g.fillStyle = '#fff';
    g.lineWidth = 3; g.strokeStyle = 'rgba(5,3,12,0.9)'; g.lineJoin = 'round';
    g.strokeText(String(i % 50), x + s * 1.15, y + 1); g.fillText(String(i % 50), x + s * 1.15, y + 1);
  });
});

const fontsOk = await page.evaluate(() => document.fonts.check('700 16px Rajdhani') && document.fonts.check('700 16px Cinzel'));
console.log(`fonts ${fontsOk ? 'loaded' : 'NOT loaded (fallback faces)'}${errors.length ? ` · errors: ${JSON.stringify(errors)}` : ''}`);
await browser.close();
