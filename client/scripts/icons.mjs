// Renders the SVG brand mark to the PNG icons the PWA manifest needs. Run: node scripts/icons.mjs
import { chromium } from '@playwright/test';

const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${pad ? 0 : 14}" fill="#16181a"/><g transform="translate(32 32) scale(${pad ? 0.72 : 1}) translate(-32 -32)"><path d="M18 14h28v6H24v24h16V34h-8v-6h14v22H18z" fill="#dcf53c"/></g></svg>`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, pad] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-512-maskable.png', 512, true], ['apple-touch-icon.png', 180, true]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}body{background:transparent}</style><img src="data:image/svg+xml,${encodeURIComponent(mark(pad))}" width="${size}" height="${size}">`);
  await page.locator('img').screenshot({ path: `public/${file}`, omitBackground: true });
}
await browser.close();
console.log('icons written');
