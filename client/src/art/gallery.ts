// Dev-only art gallery (scripts/art-gallery.mjs imports this): lays every painter out on one canvas.
import { FACTION } from './bible.ts';
import { drawShip } from './ships.ts';
import { drawPlanet, drawStar, type WorldType, type StarType } from './planets.ts';
import { drawStarNode, drawTwinkle, drawPulsarBeams, drawAccretionShimmer, drawOrbitLines, drawSpecks, type StarKind } from './stars.ts';

const TEAM = [FACTION.azure.base, FACTION.crimson.base, FACTION.gilded.base, FACTION.neutral.base];
const CLS = ['scout', 'corvette', 'frigate', 'bombard', 'cruiser', 'dread'];

export async function gallery(g: CanvasRenderingContext2D, section: string, dpr: number) {
  g.font = '700 13px "Alegreya Sans", sans-serif'; g.fillStyle = '#ece3cf';
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
  if (section === 'stars') {
    const kinds: StarKind[] = ['yellow', 'red', 'blue', 'white', 'binary', 'pulsar', 'blackhole', 'throne'];
    const t = 2.3;
    kinds.forEach((k, i) => {
      const x = 90 + i * 165;
      for (const [row, r, fog] of [[0, 22, false], [1, 9, false], [2, 5, false], [3, 9, true]] as [number, number, boolean][]) {
        const y = [110, 300, 420, 520][row];
        drawStarNode(g, x, y, r, r * dpr, k, fog);
        if (row === 0) { if (k === 'pulsar') drawPulsarBeams(g, x, y, r, t, 7); else if (k === 'blackhole') drawAccretionShimmer(g, x, y, r, t, 3); else drawTwinkle(g, x, y, r, k, t, 5); }
      }
      g.fillStyle = '#cfd6ff'; g.fillText(k, x - 20, 220);
    });
    // detail tier: a star with orbits and specks
    const bodies = [{ kind: 'habitable', q: 'rich', adj: 'ocean' }, { kind: 'gas' }, { kind: 'belt' }];
    drawOrbitLines(g, 300, 720, 40, 3, 1);
    drawStarNode(g, 300, 720, 22, 22 * dpr, 'yellow');
    drawSpecks(g, 300, 720, 40, bodies, t, 11, 1.6, dpr, 'colony', 'X');
    drawOrbitLines(g, 800, 720, 40, 3, 1);
    drawStarNode(g, 800, 720, 16, 16 * dpr, 'blackhole');
    drawSpecks(g, 800, 720, 40, [{ kind: 'barren', q: 'rich' }, { kind: 'moon' }, { kind: 'ruin' }, { kind: 'station' }], t, 5, 1.6, dpr, 'colony', 'X');
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
