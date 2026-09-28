// Browser smoke test: signs in as each role and visits every screen, failing on any page error.
// Usage: node test/e2e-smoke.mjs [baseUrl] [screenshotDir]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }

const base = process.argv[2] || 'http://localhost:8080/';
const shots = process.argv[3] || '';
const browser = await chromium.launch();
const errors = [];
const visited = [];

async function session(email, routes, { width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${email}] pageerror ${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_CERT/.test(m.text())) errors.push(`[${email}] console ${page.url()}: ${m.text()}`); });
  await page.goto(base + '#/login');
  await page.waitForSelector('form[data-form=login]');
  if (email) {
    await page.fill('input[name=email]', email);
    await page.fill('input[name=password]', 'Demo@1234');
    await page.click('form[data-form=login] button');
    const mfa = await page.waitForSelector('.sheet input[name=code], .bottom-nav', { timeout: 8000 });
    if (await mfa.evaluate((el) => el.tagName === 'INPUT')) {
      const code = await page.textContent('.sheet .mono');
      await page.fill('.sheet input[name=code]', code.trim());
      await page.click('.sheet form button');
      await page.waitForSelector('.bottom-nav');
    }
  }
  for (const r of routes) {
    await page.goto(base + r);
    await page.waitForTimeout(350);
    await page.waitForFunction(() => !document.querySelector('main[aria-busy=true]'), null, { timeout: 8000 }).catch(() => errors.push(`[${email}] timeout ${r}`));
    const txt = await page.textContent('main');
    if (/Something went wrong|Not available/.test(txt) && !r.includes('rx')) errors.push(`[${email}] error view on ${r}: ${txt.slice(0, 200)}`);
    // Bottom navigation must never cover content: last element must end above the nav.
    const covered = await page.evaluate(() => {
      const nav = document.querySelector('.bottom-nav');
      if (!nav) return false;
      window.scrollTo(0, document.body.scrollHeight);
      const last = [...document.querySelectorAll('main .page > *')].pop();
      if (!last) return false;
      return last.getBoundingClientRect().bottom > nav.getBoundingClientRect().top + 1;
    });
    if (covered) errors.push(`[${email}] bottom nav covers content on ${r}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) errors.push(`[${email}] horizontal overflow on ${r}`);
    visited.push(`${email || 'guest'} ${r}`);
    if (shots) await page.screenshot({ path: `${shots}/${(email || 'guest').split('@')[0]}-${r.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: false });
  }
  await ctx.close();
}

const pid = 'prc_kwame';
const prod = 'prd_moringa';
await session('', ['#/c/home', '#/c/consult', `#/c/practitioner/${pid}`, '#/c/products', `#/c/product/${prod}`, '#/c/search?q=tea', '#/c/learn', '#/c/article/edu_1', '#/register', '#/demo']);
await session('akosua@demo.gh', ['#/c/home', '#/c/consult?tab=mine', `#/c/book/${pid}`, '#/c/products', '#/c/cart', '#/c/orders', '#/c/profile', '#/c/careplans', '#/c/documents', '#/c/payments', '#/c/support', '#/c/privacy', '#/c/details', '#/c/report', '#/c/rx', '#/notifications']);
await session('kwame@demo.gh', ['#/p/today', '#/p/patients', '#/p/consults', '#/p/supervision', '#/p/earnings', '#/p/profile']);
await session('clinic@demo.gh', ['#/v/dashboard', '#/v/products', '#/v/orders', '#/v/payouts', '#/v/compliance']);
await session('pharmacy@demo.gh', ['#/v/dashboard', '#/v/rx']);
await session('adwoa@demo.gh', ['#/v/dashboard']);
await session('admin@demo.gh', ['#/a/overview', '#/a/approvals', '#/a/approvals?tab=orgs', '#/a/approvals?tab=products', '#/a/care', '#/a/care?tab=adverse', '#/a/care?tab=tickets', '#/a/care?tab=reviews', '#/a/care?tab=privacy', '#/a/care?tab=quality', '#/a/finance', '#/a/finance?tab=refunds', '#/a/finance?tab=disputes', '#/a/finance?tab=settlements', '#/a/finance?tab=ledger', '#/a/finance?tab=fees', '#/a/finance?tab=settings', '#/a/risk', '#/a/risk?tab=expiring', '#/a/risk?tab=security', '#/a/risk?tab=flags', '#/a/risk?tab=roles'], { width: 1280, height: 800 });
await session('admin@demo.gh', ['#/a/overview', '#/a/finance'], { width: 390, height: 844 });
await browser.close();
console.log(`Visited ${visited.length} screens.`);
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }
console.log('No errors.');
