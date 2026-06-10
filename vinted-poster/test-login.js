// Local diagnostic: verify login flow, then inventory the /items/new form.
// Usage: SESSION_FILE=./sessions/vinted-session.json DEBUG_DIR=./debug \
//        VINTED_EMAIL=... VINTED_PASSWORD=... node test-login.js
const { chromium } = require('playwright');
const fs = require('fs');
const { ensureLoggedIn, dismissCookies, saveDebug, loadSession, saveSession } = require('./vinted');

const DEBUG_DIR = process.env.DEBUG_DIR || '/tmp/vinted-debug';

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED !== '1', args: ['--no-sandbox'] });
  const saved = loadSession();
  const context = saved ? await browser.newContext({ storageState: saved }) : await browser.newContext();
  const page = await context.newPage();
  try {
    await ensureLoggedIn(page, context);
    console.log('LOGIN OK — current URL:', page.url());

    await page.goto('https://www.vinted.cz/items/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await dismissCookies(page);
    await page.waitForTimeout(4000);
    console.log('UPLOAD PAGE URL:', page.url());

    const inventory = await page.evaluate(() => {
      const grab = (el) => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        id: el.id || '',
        name: el.getAttribute('name') || '',
        testid: el.getAttribute('data-testid') || '',
        placeholder: el.getAttribute('placeholder') || '',
        label: (el.labels && el.labels[0] ? el.labels[0].innerText : '').slice(0, 50),
        text: (el.innerText || '').slice(0, 50).replace(/\n/g, ' '),
      });
      const els = [...document.querySelectorAll('input, textarea, select, button, [data-testid]')];
      return els.map(grab).filter(x => x.id || x.testid || x.name || x.placeholder);
    });
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    fs.writeFileSync(`${DEBUG_DIR}/upload-form-inventory.json`, JSON.stringify(inventory, null, 1));
    await saveDebug(page, 'upload-page');
    console.log(`INVENTORY: ${inventory.length} elements written to ${DEBUG_DIR}/upload-form-inventory.json`);
    saveSession(await context.storageState());
  } catch (e) {
    console.error('TEST FAILED:', e.message);
    await saveDebug(page, 'test-failed');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
