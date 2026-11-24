// Captures a static picture of the scrolly's graphic at each step, for the "Two documents" example's static page.
// The graphic is drawn by the scrolly's own script, so it only exists in a browser: this opens the interactive page
// (as the example makes it) in Chromium, scrolls to each step, waits for the graphic to settle, and saves it as a
// picture with the text the script gives the chart for screen readers (used as the picture's alternative text).
// Run with `npm run example:scrolly-snapshots` after changing the scrolly's code, then `npm run example:scrolly`.
// Writes examples/scrolly/snapshots/<step>.webp (trimmed to the graphic) and examples/scrolly/snapshots/snapshots.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { GraphEvaluator, nodeRegistry } from '../src/engine';
import { parseProject } from '../src/store/project';
import { buildScrollyExample, SNAPSHOT_DIR, type Snapshot } from './make-example-scrolly';

const { project } = parseProject(JSON.stringify(buildScrollyExample({ snapshots: false })));
const { results } = await new GraphEvaluator(nodeRegistry).evaluate(project.graph, { files: project.files });
const html = results.page.outputs.html as string;

mkdirSync(SNAPSHOT_DIR, { recursive: true });
const browser = await chromium.launch();
// A desktop window: the graphic sits beside the step cards. Twice the pixels, so the pictures stay sharp.
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await page.setContent(html, { waitUntil: 'load' });
const root = page.locator('ge16-scrolly .gs-root');
await root.waitFor();
const steps = await page.locator('ge16-scrolly .gs-step').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.step!));
const snapshots: Snapshot[] = [];
for (const step of steps) {
  await page.locator(`ge16-scrolly .gs-step[data-step="${step}"]`).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForFunction((s) => document.querySelector('ge16-scrolly')?.shadowRoot?.querySelector('.gs-root')?.getAttribute('data-active-step') === s, step);
  // Dots move, fade and colour in over a second or so (some transitions run even with reduced motion).
  await page.waitForTimeout(2200);
  const png = await page.locator('ge16-scrolly .gs-graphic').screenshot({ animations: 'disabled' });
  writeFileSync(join(SNAPSHOT_DIR, `${step}.webp`), await trimToWebp(png));
  const alt = (await page.locator('ge16-scrolly svg.gs-svg').getAttribute('aria-label')) ?? `The graphic at step “${step}”`;
  snapshots.push({ step, file: `${step}.webp`, alt });
  console.log('captured', step);
}
await browser.close();

/** The picture without the empty space around the graphic (white margins, plus a little padding), as WebP. */
async function trimToWebp(png: Buffer): Promise<Buffer> {
  const url = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const { data } = g.getImageData(0, 0, c.width, c.height);
    let top = c.height, left = c.width, right = -1, bottom = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    // The graphic as it is, with the same white margin on every side.
    const pad = 32;
    const w = right - left + 1, h = bottom - top + 1;
    const out = document.createElement('canvas');
    out.width = w + 2 * pad;
    out.height = h + 2 * pad;
    const o = out.getContext('2d')!;
    o.fillStyle = '#fff';
    o.fillRect(0, 0, out.width, out.height);
    o.drawImage(c, left, top, w, h, pad, pad, w, h);
    return out.toDataURL('image/webp', 0.9);
  }, png.toString('base64'));
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}
writeFileSync(join(SNAPSHOT_DIR, 'snapshots.json'), `${JSON.stringify(snapshots, null, 2)}\n`);
console.log(`wrote ${snapshots.length} snapshots to examples/scrolly/snapshots/`);
