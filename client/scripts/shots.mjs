// Dev helper: screenshots of key screens at desktop + phone widths, with console errors and overflow checks.
// Usage: BASE=http://localhost:5174 OUT=/path node scripts/shots.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://localhost:5174';
const OUT = process.env.OUT ?? 'shots';
const browser = await chromium.launch();
const issues = [];

async function session(viewport, login) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && issues.push(`${viewport.width} console: ${m.text()}`));
  page.on('pageerror', (e) => issues.push(`${viewport.width} pageerror: ${e.message}`));
  if (login) {
    await page.goto(`${BASE}/login`);
    await page.fill('input[type=email]', login);
    await page.fill('input[type=password]', 'gateguard-demo');
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/app/);
  }
  return page;
}

async function shot(page, path, name, full = true) {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) issues.push(`${name}: horizontal overflow ${overflow}px`);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
}

const pages = (process.env.PAGES ?? 'landing,login,dashboard,events,event,attendees,scanner,register,ticket,settings,audit').split(',');
for (const [vw, tag] of [[{ width: 1440, height: 900 }, 'd'], [{ width: 390, height: 844 }, 'm']]) {
  const pub = await session(vw);
  const org = await session(vw, 'organizer@demo.gateguard.dev');
  const ev = await org.evaluate(() => fetch('/api/events').then((r) => r.json()));
  const id = ev.events[0]?.id;
  const att = await org.evaluate((id) => fetch(`/api/events/${id}/attendees`).then((r) => r.json()), id);
  const code = att.attendees?.[0]?.code;
  const map = {
    landing: [pub, '/'], login: [pub, '/login'], register: [pub, '/e/technova-demo'], ticket: [pub, `/t/${code}`],
    dashboard: [org, '/app'], events: [org, '/app/events'], event: [org, `/app/events/${id}`], attendees: [org, `/app/events/${id}?tab=attendees`],
    scanner: [org, `/app/scan/${id}`], settings: [org, '/app/settings'], audit: [org, '/app/audit'], new: [org, '/app/events/new'],
  };
  for (const p of pages) await shot(map[p][0], map[p][1], `${tag}-${p}`);
}
await browser.close();
console.log(issues.length ? issues.join('\n') : 'no console errors or overflow');
