import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import QRCode from 'qrcode';

const OPERATOR = { email: 'gate@demo.gateguard.dev', password: 'gateguard-demo' };
const ORGANIZER = { email: 'organizer@demo.gateguard.dev', password: 'gateguard-demo' };
const FIXTURES = join(import.meta.dirname, '.fixtures');

let n = 0;
async function registerViaApi(request: APIRequestContext) {
  const email = `e2e-${Date.now()}-${n++}@example.edu`;
  const res = await request.post('/api/public/events/technova-demo/register', { data: { name: `E2E Attendee ${n}`, email, affiliation: 'QA' } });
  expect(res.status()).toBe(201);
  return (await res.json()).ticket as { code: string; qr: string; name: string; event: { id: string } };
}

async function signIn(page: Page, who = OPERATOR) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/app/);
}

/** Chrome's fake camera plays an MJPEG file: we render the ticket QR to a JPEG frame and repeat it. */
async function qrVideo(page: Page, payload: string, name: string) {
  const png = await QRCode.toDataURL(payload, { width: 420, margin: 4 });
  await page.setViewportSize({ width: 640, height: 480 });
  await page.setContent(`<body style="margin:0;background:#fff;display:grid;place-items:center;height:100vh"><img src="${png}"></body>`);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 95 });
  mkdirSync(FIXTURES, { recursive: true });
  const file = join(FIXTURES, `${name}.mjpeg`);
  writeFileSync(file, Buffer.concat(Array(30).fill(jpeg)));
  return file;
}

async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 });
}

const checkedInCount = async (page: Page) => Number(await page.locator('.metric-live .metric-value').first().innerText());
const manualEntry = async (page: Page, code: string) => {
  await page.getByLabel('Manual ticket code').fill(code);
  await page.getByRole('button', { name: 'Check in' }).click();
};

test('attendee registers on the public page and receives a downloadable QR ticket', async ({ page }) => {
  await page.goto('/e/technova-demo');
  await page.getByLabel('Full name').fill('Public Registrant');
  await page.getByRole('textbox', { name: 'Email' }).fill(`public-${Date.now()}@example.edu`);
  await page.getByLabel(/College/).fill('CSE');
  const submit = page.getByRole('button', { name: /Register/ });
  await expect(submit).toBeDisabled(); // consent required
  await page.getByRole('checkbox').check();
  await submit.click();
  await page.waitForURL(/\/t\/[0-9A-Z-]{14}\?new=1/);
  await expect(page.getByText('You’re registered.')).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code for ticket/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download image' }).click();
  expect((await download).suggestedFilename()).toMatch(/^ticket-[0-9A-Z-]+\.png$/);
});

test('camera scan admits a real QR once, ignores it while it stays in view, then rejects duplicates and forgeries', async ({ request }) => {
  const ticket = await registerViaApi(request);
  const helper = await chromium.launch();
  const video = await qrVideo(await helper.newPage(), ticket.qr, 'valid');
  await helper.close();

  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  });
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, permissions: ['camera'] });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`/app/scan/${ticket.event.id}`);
  await expect(page.locator('.metric-live .metric-value')).not.toHaveText('');
  const before = await checkedInCount(page);

  await page.getByRole('button', { name: 'Start camera' }).click();
  const verdict = page.locator('.verdict').first();
  await expect(verdict).toHaveClass(/verdict-admit/, { timeout: 15_000 });
  await expect(verdict).toContainText('ADMIT');
  await expect(verdict).toContainText(ticket.name);
  await expect.poll(() => checkedInCount(page)).toBe(before + 1);

  // QR remains in the camera view: no repeated submissions.
  await page.waitForTimeout(4000);
  const rows = page.locator('[aria-labelledby="queue-h"] li');
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Stop' }).click();

  await manualEntry(page, ticket.code.toLowerCase());
  await expect(verdict).toHaveClass(/verdict-deny/);
  await expect(verdict).toContainText('USED');
  await expect(verdict).toContainText('First entry');

  const sig = ticket.qr.slice(-86);
  await manualEntry(page, ticket.qr.slice(0, -86) + (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1));
  await expect(verdict).toContainText('FORGED');

  await manualEntry(page, 'not-a-ticket');
  await expect(verdict).toContainText('INVALID');
  expect(await checkedInCount(page)).toBe(before + 1);
  await browser.close();
});

test('camera permission denial is explained, with manual entry still available', async () => {
  // Full Chromium (not the headless shell) implements real permission denial.
  const browser = await chromium.launch({ channel: 'chromium', args: ['--use-fake-device-for-media-stream', '--deny-permission-prompts'] });
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, permissions: [] });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto('/app/scan');
  await page.getByRole('link', { name: /Open scanner/ }).first().click();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByText(/Camera permission was denied/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Manual ticket code')).toBeEnabled();
  await browser.close();
});

async function openOfflineReadyScanner(ctx: BrowserContext, eventId: string, tickets: number) {
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`/app/scan/${eventId}`);
  await waitForServiceWorker(page);
  await expect(page.getByText(new RegExp(`\\d+ ticket statuses cached`))).toBeVisible();
  await expect(page.getByText('Signature key cached')).toBeVisible();
  expect(tickets).toBeGreaterThan(0);
  return page;
}

test('offline scans persist across reloads, are marked provisional, and sync when the network returns', async ({ browser, request }) => {
  const ticket = await registerViaApi(request);
  const ctx = await browser.newContext();
  const page = await openOfflineReadyScanner(ctx, ticket.event.id, 1);

  await ctx.setOffline(true);
  await page.reload(); // served by the service worker
  await expect(page.getByRole('heading', { name: /TechNova/ })).toBeVisible();
  await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();

  await manualEntry(page, ticket.code);
  const verdict = page.locator('.verdict').first();
  await expect(verdict).toHaveClass(/verdict-caution/);
  await expect(verdict).toContainText('ADMIT*');
  await expect(verdict).toContainText('Provisional');

  await manualEntry(page, ticket.code); // same gate, still offline
  await expect(verdict).toContainText(/Already admitted at this gate/);

  await page.reload();
  await expect(page.getByText('Pending sync').first()).toBeVisible();
  await expect(page.getByText(/2 to sync/).first()).toBeVisible();

  await ctx.setOffline(false);
  await expect(page.getByText('Pending sync')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[aria-labelledby="queue-h"]').getByText('Admitted')).toHaveCount(1);
  const status = await request.get(`/api/public/tickets/${ticket.code}`);
  expect((await status.json()).ticket.status).toBe('checked_in');
  await ctx.close();
});

test('two offline gates admitting the same ticket reconcile to one check-in and a flagged conflict', async ({ browser, request }) => {
  const ticket = await registerViaApi(request);
  const gateA = await browser.newContext();
  const gateB = await browser.newContext();
  const a = await openOfflineReadyScanner(gateA, ticket.event.id, 1);
  const b = await openOfflineReadyScanner(gateB, ticket.event.id, 1);

  await gateA.setOffline(true);
  await gateB.setOffline(true);
  await manualEntry(a, ticket.code);
  await manualEntry(b, ticket.code);
  await expect(a.locator('.verdict').first()).toContainText('ADMIT*');
  await expect(b.locator('.verdict').first()).toContainText('ADMIT*');

  await gateA.setOffline(false);
  await expect(a.locator('[aria-labelledby="queue-h"]').getByText('Admitted')).toBeVisible({ timeout: 20_000 });
  await gateB.setOffline(false);
  await expect(b.locator('[aria-labelledby="queue-h"]').getByText('Offline conflict')).toBeVisible({ timeout: 20_000 });

  // The organizer sees exactly one official check-in and the conflict alert.
  const org = await (await browser.newContext()).newPage();
  await signIn(org, ORGANIZER);
  await org.goto(`/app/events/${ticket.event.id}?tab=scans`);
  await org.getByRole('button', { name: 'Offline conflicts' }).click();
  await expect(org.getByRole('cell', { name: new RegExp(ticket.code) })).toHaveCount(1);
  await org.goto(`/app/events/${ticket.event.id}`);
  await expect(org.getByText(/offline scans? .*rejected on sync/)).toBeVisible();
});

test('public pages have no horizontal overflow or console errors on a phone', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['/', '/login', '/e/technova-demo', '/does-not-exist']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});
