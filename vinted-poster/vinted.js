const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = process.env.SESSION_FILE || '/app/sessions/vinted-session.json';
const DEBUG_DIR = process.env.DEBUG_DIR || '/tmp/vinted-debug';
const DRY_RUN = process.env.DRY_RUN === '1';
const HEADLESS = process.env.HEADED !== '1';
const EMAIL = process.env.VINTED_EMAIL;
const PASSWORD = process.env.VINTED_PASSWORD;

const BASE = 'https://www.vinted.cz';

// --- diagnostics: every failure leaves a screenshot + html + url behind ---
async function saveDebug(page, label) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(DEBUG_DIR, `${stamp}_${label}`);
    fs.writeFileSync(`${base}.url.txt`, page.url());
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    const html = await page.content().catch(() => '');
    fs.writeFileSync(`${base}.html`, html);
    console.log(`[debug] saved ${base}.*`);
  } catch (e) {
    console.warn(`[debug] capture failed: ${e.message}`);
  }
}

async function downloadImages(imageUrls) {
  const localPaths = [];
  for (let i = 0; i < Math.min(imageUrls.length, 5); i++) {
    try {
      const response = await axios.get(imageUrls[i], { responseType: 'arraybuffer' });
      const tempPath = `/tmp/img_${Date.now()}_${i}.jpg`;
      fs.writeFileSync(tempPath, response.data);
      localPaths.push(tempPath);
    } catch (e) { console.warn(`Image ${i} failed: ${e.message}`); }
  }
  return localPaths;
}

function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch (e) { return null; }
  }
  return null;
}

function saveSession(state) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
}

// OneTrust cookie banner blocks all clicks until dismissed
async function dismissCookies(page) {
  try {
    await page.locator('#onetrust-reject-all-handler').click({ timeout: 4000 });
    console.log('[login] cookie banner dismissed');
    await page.waitForTimeout(500);
  } catch (e) { /* banner not shown — fine */ }
}

// Reliable login probe: /api/v2/users/current is 200 with a user when
// authenticated, 403 access_denied when not. (The old /member/settings
// URL check broke when Vinted removed that page — it 404s with the URL
// kept, which read as "logged in".)
async function isLoggedIn(page) {
  try {
    const resp = await page.request.get(`${BASE}/api/v2/users/current`, {
      headers: { Accept: 'application/json' }, timeout: 10000,
    });
    return resp.ok();
  } catch (e) { return false; }
}

async function login(page) {
  console.log('[login] logging in via email form');
  await page.goto(`${BASE}/member/signup/select_type`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissCookies(page);
  // page opens in "sign up" mode; this button switches it to "log in"
  await page.getByTestId('auth-select-type--register-switch').click({ timeout: 10000 });
  await page.getByTestId('auth-select-type--login-email').click({ timeout: 10000 });
  await page.fill('#username', EMAIL, { timeout: 10000 });
  await page.fill('#password', PASSWORD);
  await page.click('button[type="submit"]');
  // wait for the app to acknowledge the session rather than guessing by URL
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    if (await isLoggedIn(page)) {
      console.log('[login] success');
      return;
    }
  }
  await saveDebug(page, 'login-failed');
  throw new Error(`Login did not complete (stuck at ${page.url()}) — check debug capture`);
}

async function ensureLoggedIn(page, context) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await dismissCookies(page);
  if (await isLoggedIn(page)) {
    console.log('[login] existing session is valid');
    return;
  }
  await login(page);
  saveSession(await context.storageState());
}

async function postToVinted({ images, title, description, price, category, brand, condition, size }) {
  const browser = await chromium.launch({ headless: HEADLESS, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const savedSession = loadSession();
  const context = savedSession
    ? await browser.newContext({ storageState: savedSession })
    : await browser.newContext();
  const page = await context.newPage();

  try {
    await ensureLoggedIn(page, context);

    const localImages = await downloadImages(images);
    if (!localImages.length) throw new Error('No images downloaded');

    await page.goto(`${BASE}/items/new`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissCookies(page);

    // Upload photos
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 })
      .catch(async (e) => { await saveDebug(page, 'no-file-input'); throw e; });
    await page.locator('input[type="file"]').first().setInputFiles(localImages);
    await page.waitForTimeout(5000);

    // ---- form fill (selectors verified against logged-in DOM during local testing) ----
    await page.fill('#title', title).catch(async (e) => { await saveDebug(page, 'no-title-field'); throw e; });
    await page.fill('#description', description);

    // Category: Děti > Oblečení (kids > clothing)
    await page.click('#catalog_id');
    await page.getByText('Děti', { exact: true }).first().click();
    await page.getByText('Oblečení', { exact: true }).first().click();

    // Brand autocomplete
    await page.fill('#brand_id', brand).catch(() => {});
    await page.getByText(brand, { exact: true }).first().click().catch(() => {});

    // Size
    await page.click('#size_id').catch(() => {});
    await page.getByText(String(size), { exact: true }).first().click().catch(() => {});

    // Condition
    const conditionLabels = {
      new_with_tags: 'Nové s visačkou', new_without_tags: 'Nové bez visačky',
      very_good: 'Velmi dobré', good: 'Dobré', satisfactory: 'Uspokojivé',
    };
    await page.click('#status_id').catch(() => {});
    await page.getByText(conditionLabels[condition] || 'Dobré', { exact: true }).first().click().catch(() => {});

    // Price
    await page.fill('#price', String(price));

    await saveDebug(page, 'form-filled');

    if (DRY_RUN) {
      console.log('[dry-run] stopping before submit');
      localImages.forEach(p => { try { fs.unlinkSync(p); } catch (e) {} });
      await browser.close();
      return { success: true, dryRun: true, listingUrl: 'DRY_RUN' };
    }

    // Submit
    await page.click('button[type="submit"]');
    await page.waitForURL(/vinted\.cz\/items\/\d+/, { timeout: 30000 })
      .catch(async (e) => { await saveDebug(page, 'submit-failed'); throw e; });

    const listingUrl = page.url();
    saveSession(await context.storageState());
    localImages.forEach(p => { try { fs.unlinkSync(p); } catch (e) {} });
    await browser.close();
    return { success: true, listingUrl };

  } catch (error) {
    await saveDebug(page, 'post-error').catch(() => {});
    await browser.close();
    throw error;
  }
}

module.exports = { postToVinted, ensureLoggedIn, isLoggedIn, login, dismissCookies, saveDebug, loadSession, saveSession };
