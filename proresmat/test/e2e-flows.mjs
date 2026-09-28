// Browser end-to-end flows: clicks through the real UI for every environment.
// Usage: node test/e2e-flows.mjs [baseUrl]   (expects freshly seeded data)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(execSync('npm root -g').toString().trim() + '/playwright')); }

const base = process.argv[2] || 'http://localhost:8080/';
const browser = await chromium.launch();
const errors = [];
const passed = [];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function open(email, viewport = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  pages.push(page);
  page.on('pageerror', (e) => errors.push(`pageerror [${email}]: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_CERT|status of 4\d\d/.test(m.text())) errors.push(`console [${email}]: ${m.text()}`); });
  await page.goto(base + '#/login');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', 'Demo@1234');
  await page.click('form[data-form=login] button');
  const el = await page.waitForSelector('.sheet input[name=code], .bottom-nav');
  if (await el.evaluate((n) => n.tagName === 'INPUT')) {
    await page.fill('.sheet input[name=code]', (await page.textContent('.sheet .mono')).trim());
    await page.click('.sheet form button');
    await page.waitForSelector('.bottom-nav');
  }
  return { page, ctx };
}
const settle = (page) => page.waitForFunction(() => !document.querySelector('main[aria-busy=true]') && !document.querySelector('main.loading')).then(() => page.waitForTimeout(150));
const pages = [];
async function step(name, fn) {
  try { await fn(); passed.push(name); } catch (e) {
    const pg = pages.at(-1);
    const where = pg ? `${pg.url()} :: ${(await pg.textContent('body').catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}` : '';
    errors.push(`FAILED ${name}: ${e.message.split('\n')[0]}\n   at ${where}`);
  }
}
const expectText = async (page, sel, re) => {
  await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ''), [sel, re.source], { timeout: 8000 });
};

// ---------- Customer ----------
const { page: c } = await open('akosua@demo.gh');
await step('customer books a telephone consultation and pays by Mobile Money', async () => {
  await c.goto(base + '#/c/practitioner/prc_efua'); await settle(c);
  await c.click('text=Book a consultation');
  await c.click('[data-act=mode][data-v=telephone]'); await settle(c);
  await c.click('.slot:not([disabled])'); await settle(c);
  await c.fill('textarea[name=reason]', 'Lower back pain after farm work for one week.');
  await c.click('form[data-form=screen] button.primary'); await settle(c);
  await c.check('input[name=consent]'); await c.check('input[name=policy]');
  await c.click('form[data-form=confirm] button.primary'); await settle(c);
  await c.click('form[data-form=pay] button.primary'); await settle(c);
  await expectText(c, 'main', /Mobile Money Payment/);
  await c.click('button[value=success]'); await settle(c);
  await expectText(c, 'main', /Payment received/);
  await c.click('text=Continue'); await settle(c);
  await expectText(c, 'main', /Confirmed/);
});
await step('red-flag answer stops the booking and shows emergency guidance', async () => {
  await c.goto(base + '#/c/book/prc_ama'); await settle(c);
  await c.click('[data-act=mode][data-v=telephone]'); await settle(c);
  await c.click('.slot:not([disabled])'); await settle(c);
  await c.fill('textarea[name=reason]', 'Chest tightness');
  await c.check('input[value=chest_pain]');
  await c.click('form[data-form=screen] button.primary');
  await expectText(c, '.sheet', /Get emergency care now/);
  await c.click('.sheet [data-close]');
});
await step('customer adds products from two sellers, checks out and pays by card', async () => {
  await c.goto(base + '#/c/product/prd_cryptolepis'); await settle(c);
  await c.click('form[data-form=add] button'); await settle(c);
  await c.goto(base + '#/c/product/prd_neem'); await settle(c);
  await c.click('form[data-form=add] button'); await settle(c);
  await c.goto(base + '#/c/cart'); await settle(c);
  await expectText(c, 'main', /Sold by PRORESMAT[\s\S]*Sold by Nkabom/);
  await c.check('input[name=channel][value=card]');
  await c.check('input[name=terms]');
  await c.click('form[data-form=checkout] button.primary'); await settle(c);
  await c.click('button[value=success]'); await settle(c);
  await expectText(c, 'main', /Payment received/);
  await c.goto(base + '#/c/orders'); await settle(c);
  await expectText(c, 'main', /OR-\d+/);
});
await step('customer uploads an encrypted document and opens it', async () => {
  await c.goto(base + '#/c/documents'); await settle(c);
  await c.setInputFiles('input[type=file]', { name: 'blood-test.png', mimeType: 'image/png', buffer: PNG });
  await c.click('form[data-form=upload] button'); await settle(c);
  await expectText(c, 'main', /blood-test\.png/);
  await c.click('[data-act=view]');
  await expectText(c, '.sheet', /expires in 5 minutes/);
  await c.click('.sheet [data-close]');
});
await step('customer sees receipt and raises a support request', async () => {
  await c.goto(base + '#/c/payments'); await settle(c);
  await c.click('.list-item >> nth=0'); await settle(c);
  await expectText(c, 'main', /Paystack reference/);
  await c.goto(base + '#/c/support'); await settle(c);
  await c.click('[data-act=new]');
  await c.fill('.sheet input[name=subject]', 'Delivery time');
  await c.fill('.sheet textarea[name=message]', 'When will my order arrive?');
  await c.click('.sheet form button.primary'); await settle(c);
  await expectText(c, 'main', /Delivery time/);
});
await step('customer switches language to Twi', async () => {
  await c.goto(base + '#/c/profile'); await settle(c);
  await c.click('[data-act=lang][data-v=tw]'); await settle(c);
  await expectText(c, '.bottom-nav', /Fie/);
  await c.click('[data-act=lang][data-v=en]'); await settle(c);
});

// ---------- Practitioner ----------
const { page: p } = await open('kwame@demo.gh');
await step('practitioner runs a consultation: start, notes, care plan, complete', async () => {
  await p.goto(base + '#/p/today'); await settle(p);
  await p.click('main .list-item >> nth=0'); await settle(p);
  await p.click('[data-act=start]'); await settle(p);
  await p.fill('textarea[name=assessment]', 'Morning stiffness improving; no red flags.');
  await p.click('form[data-form=notes] button.primary'); await settle(p);
  await p.click('[data-act=plan]');
  await p.selectOption('.sheet select[name="items.0.productId"]', { index: 1 });
  await p.fill('.sheet input[name="items.0.dosage"]', '1 cup');
  await p.fill('.sheet textarea[name=advice]', 'Continue gentle exercise daily.');
  await p.click('.sheet form button.primary'); await settle(p);
  await p.click('[data-act=complete]');
  await p.click('.sheet form button.primary'); await settle(p);
  await expectText(p, 'main', /Completed/);
});
await step('supervisor queue and earnings screens load', async () => {
  await p.goto(base + '#/p/supervision'); await settle(p);
  await expectText(p, 'main', /Ama Boateng/);
  await p.goto(base + '#/p/earnings'); await settle(p);
  await expectText(p, 'main', /Payouts/);
});

// ---------- Vendor ----------
const { page: v } = await open('clinic@demo.gh');
await step('clinic fulfils an order through every stage', async () => {
  await v.goto(base + '#/v/orders'); await settle(v);
  await v.click('main .list-item >> nth=0'); await settle(v);
  const pickup = /Pickup/.test(await v.textContent('main'));
  await v.click('[data-act=next][data-v=accepted]'); await settle(v);
  await v.click('[data-act=next][data-v=stock_confirmed]'); await settle(v);
  await v.click('[data-act=next][data-v=prepared]');
  for (const inp of await v.$$('.sheet input[name$=".batch"]')) await inp.fill('NK-2610');
  for (const inp of await v.$$('.sheet input[name$=".expiry"]')) await inp.fill('2027-10-31');
  await v.click('.sheet form button.primary'); await settle(v);
  await v.click(`[data-act=next][data-v=${pickup ? 'ready_for_pickup' : 'dispatched'}]`); await settle(v);
  await v.click('[data-act=next][data-v=delivered]');
  await v.click('.sheet form button.primary'); await settle(v);
  await expectText(v, 'main', /Delivered/);
});
await step('clinic creates a draft listing; claims wording is blocked', async () => {
  await v.goto(base + '#/v/products'); await settle(v);
  await v.click('[data-act=new]');
  const f = { name: 'Lemongrass Calm Tea', packSize: '20 bags', fdaRegNo: 'FDA/HD.26-0001', fdaExpiry: '2028-06-30', manufacturer: 'Nkabom Herbal Clinic', ingredients: 'Lemongrass leaf 2 g', indication: 'Cures stress permanently', directions: 'One cup at night', duration: '14 days', warnings: 'May cause drowsiness', contraindications: 'Allergy to lemongrass', pregnancy: 'Seek advice before use', interactions: 'May add to sedatives', priceGhs: '25', stock: '30' };
  for (const [k, val] of Object.entries(f)) await v.fill(`.sheet [name=${k}]`, val);
  await v.click('.sheet form button.primary');
  await expectText(v, '.sheet', /cure or guarantee/);
  await v.fill('.sheet [name=indication]', 'Traditionally used to support relaxation.');
  await v.click('.sheet form button.primary'); await settle(v);
  await expectText(v, 'main', /Lemongrass Calm Tea/);
});

// ---------- Admin ----------
const { page: a } = await open('admin@demo.gh', { width: 1280, height: 900 });
await step('admin approves a practitioner application', async () => {
  await a.goto(base + '#/a/approvals'); await settle(a);
  await a.click('tr:has-text("Abena Ofori") [data-act=viewPrac]');
  await a.click('.sheet [data-act=approvePrac]');
  await a.click('.sheet form[data-form=approvePrac] button.primary'); await settle(a);
  await expectText(a, 'main', /Abena Ofori[\s\S]*Active/);
});
await step('admin approves a product listing with a recorded reason', async () => {
  await a.goto(base + '#/a/approvals?tab=products'); await settle(a);
  await a.click('tr:has-text("Garlic & Honey") [data-act=viewProd]');
  await a.click('.sheet [data-act=prod][data-action=approve]');
  await a.fill('.sheet textarea[name=reason]', 'FDA entry and label verified');
  await a.click('.sheet form button.primary'); await settle(a);
  await expectText(a, 'main', /Garlic & Honey[\s\S]*Approved/);
});
await step('finance runs settlement and reconciliation is balanced', async () => {
  await a.goto(base + '#/a/finance?tab=settlements'); await settle(a);
  await a.click('[data-act=settle]');
  await a.click('.sheet form button.primary'); await settle(a);
  await expectText(a, 'main', /PO-/);
  await a.click('[data-act=reconcile]');
  await expectText(a, '.sheet', /Ledger balanced/);
});
await step('admin records follow-up on the red-flag queue', async () => {
  await a.goto(base + '#/a/care'); await settle(a);
  await a.click('[data-act=cq] >> nth=0');
  await a.fill('.sheet textarea[name=note]', 'Called customer; advised to attend emergency unit. Confirmed attended.');
  await a.click('.sheet form button.primary'); await settle(a);
  await expectText(a, 'main', /Followed up/);
});

// ---------- Password reset ----------
const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const g = await guestCtx.newPage();
await step('forgot password: code by SMS, new password, sign in', async () => {
  await g.goto(base + '#/forgot'); await settle(g);
  await g.fill('input[name=email]', 'kojo@demo.gh');
  await g.click('form[data-form=req] button'); await settle(g);
  const code = (await g.textContent('main .mono')).trim();
  await g.fill('input[name=code]', code);
  await g.fill('input[name=password]', 'Kojo2026pass');
  await g.click('form[data-form=reset] button'); await settle(g);
  await g.fill('input[name=email]', 'kojo@demo.gh');
  await g.fill('input[name=password]', 'Kojo2026pass');
  await g.click('form[data-form=login] button');
  await g.waitForSelector('.bottom-nav');
});

await browser.close();
console.log(`Passed ${passed.length} flows:\n  ${passed.join('\n  ')}`);
if (errors.length) { console.log('\n' + errors.join('\n')); process.exit(1); }
