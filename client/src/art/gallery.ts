// Dev-only art gallery (scripts/art-gallery.mjs imports this): lays every painter out on one canvas.
import { drawShip } from './ships.ts';
import { drawPlanet, drawStar, type WorldType, type StarType } from './planets.ts';

const TEAM = ['#3fd0ff', '#ff4f7b', '#ffd23f', '#8a8aa8'];
const CLS = ['scout', 'corvette', 'frigate', 'bombard', 'cruiser', 'dread'];

export async function gallery(g: CanvasRenderingContext2D, section: string, dpr: number) {
  g.font = '600 13px Rajdhani, sans-serif'; g.fillStyle = '#cfd6ff';
  if (section === 'ships') {
    const owners = [0, 1, 2, -1];
    owners.forEach((o, row) => {
      CLS.forEach((cls, col) => {
        const x = 110 + col * 210, y = 120 + row * 200;
        const len = [70, 82, 100, 110, 128, 165][col];
        drawShip(g, x, y, len, len * dpr, cls, o, TEAM[o < 0 ? 3 : o], 0, { shadow: { dx: 6, dy: 9, alpha: 0.6 } });
        g.fillStyle = '#cfd6ff'; g.fillText(`${cls}`, x - 20, y + 95);
      });
    });
    // small sizes + rotations
    owners.forEach((o, row) => {
      for (let i = 0; i < 8; i++) {
        const x = 1290 + (i % 2) * 50, y = 60 + row * 200 + Math.floor(i / 2) * 40;
        drawShip(g, x, y, 26, 26 * dpr, CLS[(i + 2) % 6], o, TEAM[o < 0 ? 3 : o], i * 0.7, { shadow: { dx: 2, dy: 3, alpha: 0.5 } });
      }
    });
  }
  if (section === 'planets') {
    const types: WorldType[] = ['terran', 'garden', 'ocean', 'desert', 'ice', 'lava', 'barren', 'gas', 'toxic', 'ash', 'crystal', 'thorn'];
    types.forEach((t, i) => {
      const x = 110 + (i % 6) * 210, y = 120 + Math.floor(i / 6) * 230;
      drawPlanet(g, x, y, 60, 60 * dpr, { type: t, seed: 1234 + i * 77, dev: i % 3 === 0 ? 4 : 0, ring: t === 'gas' });
      g.fillStyle = '#cfd6ff'; g.fillText(t, x - 20, y + 100);
    });
    const stars: StarType[] = ['yellow', 'red', 'blue', 'white', 'binary', 'pulsar', 'blackhole', 'throne'];
    stars.forEach((t, i) => { const x = 90 + i * 160, y = 640; drawStar(g, x, y, 18, 18 * dpr, t); g.fillStyle = '#cfd6ff'; g.fillText(t, x - 20, y + 90); });
    // small sizes
    types.forEach((t, i) => drawPlanet(g, 60 + i * 40, 820, 9, 9 * dpr, { type: t, seed: 99 + i, dev: 3, ring: t === 'gas' }));
  }
}
