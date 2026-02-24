const { chromium } = require('playwright');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = '/app/sessions/vinted-session.json';
const EMAIL = process.env.VINTED_EMAIL;
const PASSWORD = process.env.VINTED_PASSWORD;

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
    try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch(e) { return null; }
  }
  return null;
}

function saveSession(state) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(state));
}

async function postToVinted({ images, title, description, price, category, brand, condition, size }) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const savedSession = loadSession();
  const context = savedSession
    ? await browser.newContext({ storageState: savedSession })
    : await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('https://www.vinted.cz/member/settings', { waitUntil: 'networkidle', timeout: 30000 });
    const isLoggedIn = page.url().includes('/member/settings');

    if (!isLoggedIn) {
      await page.goto('https://www.vinted.cz/auth/login', { waitUntil: 'networkidle' });
      await page.fill('[data-testid="login-form-email"]', EMAIL);
      await page.fill('[data-testid="login-form-password"]', PASSWORD);
      await page.click('[data-testid="login-form-submit"]');
      await page.waitForURL(/vinted\.cz\/(?!auth)/, { timeout: 30000 });
      saveSession(await context.storageState());
    }

    const localImages = await downloadImages(images);
    if (!localImages.length) throw new Error('No images downloaded');

    await page.goto('https://www.vinted.cz/items/new', { waitUntil: 'networkidle', timeout: 30000 });

    // Upload photos
    // ⚠️ SELECTOR MUST BE VERIFIED: open vinted.cz/items/new in Chrome, right-click file input, Inspect
    await page.waitForSelector('input[type="file"]', { timeout: 15000 });
    await page.locator('input[type="file"]').first().setInputFiles(localImages);
    await page.waitForTimeout(5000);

    // Fill form fields
    // ⚠️ ALL data-testid VALUES BELOW ARE APPROXIMATIONS — verify each one before use
    await page.fill('[data-testid="item-title-input"]', title);
    await page.fill('[data-testid="item-description-input"]', description);

    // Category: Děti > Oblečení
    await page.click('[data-testid="item-category-select"]');
    await page.waitForSelector('[data-testid="category-item"]');
    await page.click('text=Děti');
    await page.click('text=Oblečení');

    // Brand autocomplete
    await page.fill('[data-testid="item-brand-input"]', brand);
    await page.click(`text=${brand}`);

    // Size
    await page.click('[data-testid="item-size-select"]');
    await page.click(`[data-testid="size-option-${size}"]`);

    // Condition (map to Vinted condition IDs)
    const conditionMap = { new_with_tags: 6, new_without_tags: 1, very_good: 2, good: 3, satisfactory: 4 };
    await page.click(`[data-testid="item-condition-${conditionMap[condition] || 3}"]`);

    // Price
    await page.fill('[data-testid="item-price-input"]', String(price));

    // Submit
    await page.click('[data-testid="item-upload-submit"]');
    await page.waitForURL(/vinted\.cz\/items\/\d+/, { timeout: 30000 });

    const listingUrl = page.url();
    saveSession(await context.storageState());
    localImages.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });
    await browser.close();
    return { success: true, listingUrl };

  } catch (error) {
    await browser.close();
    if (error.message.includes('session') || error.message.includes('login')) {
      if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    }
    throw error;
  }
}

module.exports = { postToVinted };
