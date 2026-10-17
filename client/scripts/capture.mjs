// Captures the real product screenshots used on the landing page and in the README.
// Needs the dev API + web server running with demo data (npm run seed). Usage: node scripts/capture.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const browser = await chromium.launch();
async function signedIn(viewport, email) {
  const page = await (await browser.newContext({ viewport, deviceScaleFactor: 2 })).newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('gateguard-demo');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
  return page;
}
const settle = (p) => p.waitForLoadState('networkidle').then(() => p.waitForTimeout(800));

const org = await signedIn({ width: 1440, height: 1000 }, 'organizer@demo.gateguard.dev');
const { events } = await org.evaluate(() => fetch('/api/events').then((r) => r.json()));
const id = events.find((e) => e.isDemo).id;
await org.goto(`${BASE}/app/events/${id}`);
await settle(org);
await org.screenshot({ path: 'public/screens/event-live.png' });
await org.goto(`${BASE}/app`);
await settle(org);
await org.screenshot({ path: 'public/screens/dashboard.png' });

// A fresh registration checked in through the manual-entry path, so the verdict shown is real.
const reg = await org.request.post(`${BASE}/api/public/events/technova-demo/register`, {
  data: { name: 'Ishita Verma', email: `shot-${Date.now()}@example.edu`, affiliation: 'Computer Engg.' },
});
const { ticket } = await reg.json();
for (const [viewport, file] of [[{ width: 1440, height: 1000 }, 'scanner'], [{ width: 390, height: 844 }, 'scanner-mobile']]) {
  const op = await signedIn(viewport, 'gate@demo.gateguard.dev');
  await op.goto(`${BASE}/app/scan/${id}`);
  await settle(op);
  await op.getByLabel('Manual ticket code').fill(ticket.code);
  await op.getByRole('button', { name: 'Check in' }).click();
  await op.locator('.verdict:not(.verdict-idle)').waitFor();
  await op.waitForTimeout(500);
  if (file === 'scanner-mobile') await op.locator('.verdict').scrollIntoViewIfNeeded();
  await op.screenshot({ path: `public/screens/${file}.png` });
}
const pub = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
await pub.goto(`${BASE}/t/${ticket.code}`);
await settle(pub);
await pub.screenshot({ path: 'public/screens/ticket.png' });
await browser.close();
console.log('captured');
