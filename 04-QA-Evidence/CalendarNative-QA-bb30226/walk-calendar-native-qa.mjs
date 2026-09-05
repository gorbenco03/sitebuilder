/**
 * Deterministic stranger walk for calendar-native QA (VISION.md §8).
 * Screenshot filenames are the action just performed (owner rule 2026-09-02).
 *
 * Usage (server already on PORT):
 *   PORT=18791 DATA_DIR=/tmp/hidook-cal-qa-bb30226 node 04-QA-Evidence/CalendarNative-QA-bb30226/walk-calendar-native-qa.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || '18791';
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = process.env.DATA_DIR || '/tmp/hidook-cal-qa-bb30226';
const OUT = path.join(__dirname, 'screenshots');
const LOG = path.join(__dirname, 'walk-log.json');
fs.mkdirSync(OUT, { recursive: true });

const findings = [];
const shots = [];
const notes = {};

function rec(kind, title, extra = {}) {
  findings.push({ kind, title, ...extra });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push({ name, file });
  console.log('SHOT', name);
  return file;
}

async function pause(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function visibleEnglishJargon(text) {
  const hits = [];
  const rules = [
    /\bblackout\b/i,
    /\boverride\b/i,
    /\bTimezone\b/,
    /\bbuffer\b/i,
    /\bcustomerId\b/,
    /\bsiteId\b/,
    /\bslot\b/i,
    /\bpreview-session\b/i,
    /\bTODO\b/,
    /\bFIXME\b/,
    /\blorem\b/i,
  ];
  for (const re of rules) {
    if (re.test(text)) hits.push(re.source);
  }
  return hits;
}

function secretish(text) {
  const hits = [];
  if (/re_[A-Za-z0-9]{16,}/.test(text)) hits.push('resend-like');
  if (/SG\.[A-Za-z0-9._-]{16,}/.test(text)) hits.push('sendgrid-like');
  if (/sk_live_[A-Za-z0-9]{8,}/.test(text)) hits.push('stripe-live');
  if (/RESEND_API_KEY\s*[:=]/.test(text)) hits.push('RESEND_API_KEY assignment');
  if (/SMTP_PASS(WORD)?\s*[:=]/.test(text)) hits.push('SMTP_PASS assignment');
  return hits;
}

async function metrics(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const controls = [];
    const sels = [
      '.hnb__cta',
      '.hnb__svc',
      '.hnb__slot',
      '.hod-tab',
      '.hod-btn',
      '[data-hod-act]',
      '[data-hnb-submit]',
      'a[href^="tel:"]',
      'a[href*="wa.me"]',
    ];
    for (const sel of sels) {
      document.querySelectorAll(sel).forEach((el, i) => {
        const r = el.getBoundingClientRect();
        controls.push({
          sel,
          i,
          text: (el.innerText || el.textContent || '').slice(0, 80),
          href: el.getAttribute('href') || null,
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          clippedRight: r.right > vw + 1,
          clippedLeft: r.left < -1,
          zeroSize: r.width < 1 || r.height < 1,
        });
      });
    }
    return {
      href: location.href,
      title: document.title,
      viewport: vw,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyText: (document.body.innerText || '').slice(0, 4000),
      htmlLen: document.documentElement.outerHTML.length,
      html: document.documentElement.outerHTML,
      controls,
    };
  });
}

async function clickFirstDayWithSlots(page) {
  const days = page.locator('.hnb__day');
  const n = await days.count();
  for (let i = 0; i < n; i++) {
    await days.nth(i).click();
    await pause(250);
    const slots = await page.locator('.hnb__slot').count();
    const empty = await page.locator('.hnb__empty').count();
    const label = (await days.nth(i).innerText()).replace(/\s+/g, ' ');
    if (slots > 0) return { index: i, label, slots, empty: false };
    if (empty) {
      // keep looking
    }
  }
  return { index: -1, label: null, slots: 0, empty: true };
}

async function clickWeekendDay(page) {
  const days = page.locator('.hnb__day');
  const n = await days.count();
  for (let i = 0; i < n; i++) {
    const label = await days.nth(i).innerText();
    if (/Du|Sâ/.test(label)) {
      await days.nth(i).click();
      await pause(300);
      return { index: i, label: label.replace(/\s+/g, ' ') };
    }
  }
  return null;
}

function sqliteQuery(sql) {
  const script = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(path.join(DATA_DIR, 'calendar-native.sqlite'))});
    const rows = db.prepare(${JSON.stringify(sql)}).all();
    process.stdout.write(JSON.stringify(rows));
  `;
  const r = spawnSync(process.execPath, ['--experimental-sqlite', '-e', script], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    return { error: r.stderr || r.stdout, rows: [] };
  }
  try {
    return { rows: JSON.parse(r.stdout || '[]') };
  } catch (e) {
    return { error: String(e), raw: r.stdout, rows: [] };
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  desk.on('dialog', (d) => d.accept());
  mob.on('dialog', (d) => d.accept());

  // ---- 1. Public widget desktop ----
  await desk.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'networkidle', timeout: 25000 });
  await desk.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
  await pause(700);
  await shot(desk, '01-opened-public-widget-desktop-loaded');
  const deskM = await metrics(desk);
  notes.widgetDesktop = {
    title: deskM.title,
    scrollWidth: deskM.scrollWidth,
    bodyText: deskM.bodyText,
    jargon: visibleEnglishJargon(deskM.bodyText),
    secrets: secretish(deskM.html),
    telHrefs: deskM.controls.filter((c) => c.href && c.href.startsWith('tel:')),
    waHrefs: deskM.controls.filter((c) => c.href && /wa\.me/.test(c.href)),
  };

  const weekend = await clickWeekendDay(desk);
  await pause(400);
  await shot(desk, '02-clicked-weekend-day-empty-or-slots');
  notes.weekend = weekend;
  notes.weekendEmptyText = await desk.locator('.hnb__empty, .hnb__slots').innerText().catch(() => '');

  const picked = await clickFirstDayWithSlots(desk);
  notes.pickedDay = picked;
  await pause(300);
  const slotCount = await desk.locator('.hnb__slot').count();
  if (slotCount > 0) await desk.locator('.hnb__slot').nth(0).click();
  await pause(300);
  await shot(desk, '03-clicked-weekday-slot-form-visible');

  // unhappy empty submit
  await desk.locator('[data-hnb-submit]').click();
  await pause(400);
  await shot(desk, '04-clicked-confirm-without-name-email-unhappy');
  notes.unhappyInline = await desk.locator('[data-hnb-inline-error]').innerText().catch(() => '');

  await desk.fill('input[name="name"]', 'Ana Popescu');
  await desk.fill('input[name="email"]', 'ana.popescu@example.com');
  await desk.fill('input[name="phone"]', '0722000111');
  await desk.fill('input[name="note"]', 'prima vizită QA');
  await shot(desk, '05-filled-visitor-form-before-submit');
  await desk.locator('[data-hnb-submit]').click();
  await desk.waitForSelector('[data-hnb-success], [data-hnb-error], [data-hnb-inline-error]:not([hidden])', {
    timeout: 15000,
  });
  await pause(500);
  await shot(desk, '06-submitted-booking-result-state');
  notes.booking1 = await desk.evaluate(() => {
    const ok = document.querySelector('[data-hnb-success]');
    const err = document.querySelector('[data-hnb-error]');
    return {
      successAttr: ok ? ok.getAttribute('data-hnb-success') : null,
      successText: ok ? ok.innerText : null,
      errorText: err ? err.innerText : null,
      body: document.body.innerText.slice(0, 1500),
    };
  });

  // second booking for cancel/reschedule
  await desk.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'networkidle', timeout: 25000 });
  await desk.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
  await pause(500);
  const svc2 = desk.locator('.hnb__svc').nth(1);
  if ((await svc2.count()) > 0) await svc2.click();
  await pause(700);
  const picked2 = await clickFirstDayWithSlots(desk);
  notes.pickedDay2 = picked2;
  if ((await desk.locator('.hnb__slot').count()) > 1) {
    await desk.locator('.hnb__slot').nth(1).click();
  } else if ((await desk.locator('.hnb__slot').count()) > 0) {
    await desk.locator('.hnb__slot').nth(0).click();
  }
  await desk.fill('input[name="name"]', 'Mihai Ionescu');
  await desk.fill('input[name="email"]', 'mihai.ionescu@example.com');
  await shot(desk, '07-second-booking-form-ready');
  await desk.locator('[data-hnb-submit]').click();
  await desk.waitForSelector('[data-hnb-success], [data-hnb-error]', { timeout: 15000 });
  await pause(400);
  await shot(desk, '08-submitted-second-booking-result');
  notes.booking2 = await desk.evaluate(() => {
    const ok = document.querySelector('[data-hnb-success]');
    return { successAttr: ok ? ok.getAttribute('data-hnb-success') : null, text: ok ? ok.innerText : document.body.innerText.slice(0, 800) };
  });

  // 390 widget
  await mob.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'networkidle', timeout: 25000 });
  await mob.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
  await pause(600);
  await shot(mob, '09-opened-public-widget-390-loaded');
  const mobW = await metrics(mob);
  notes.widget390 = {
    scrollWidth: mobW.scrollWidth,
    bodyScrollWidth: mobW.bodyScrollWidth,
    viewport: 390,
    overflow: mobW.scrollWidth > 390,
    jargon: visibleEnglishJargon(mobW.bodyText),
    telHrefs: mobW.controls.filter((c) => c.href && c.href.startsWith('tel:')),
    clipped: mobW.controls.filter((c) => c.clippedRight || c.zeroSize),
    bodyText: mobW.bodyText,
  };

  // ---- 2. Owner dashboard desktop + 390 ----
  await desk.goto(`${BASE}/calendar-native/owner/`, { waitUntil: 'networkidle', timeout: 25000 });
  await desk.waitForSelector('.hod-tab, [data-hod-shell], .hod-boot', { timeout: 20000 });
  await pause(900);
  await shot(desk, '10-opened-owner-dashboard-desktop-bookings');
  const ownerDesk = await metrics(desk);
  notes.ownerDesktop = {
    title: ownerDesk.title,
    bodyText: ownerDesk.bodyText,
    jargon: visibleEnglishJargon(ownerDesk.bodyText),
    secrets: secretish(ownerDesk.html),
  };

  await mob.goto(`${BASE}/calendar-native/owner/`, { waitUntil: 'networkidle', timeout: 25000 });
  await mob.waitForSelector('.hod-tab, [data-hod-shell], .hod-boot', { timeout: 20000 });
  await pause(1000);
  await shot(mob, '11-opened-owner-dashboard-390-bookings');
  const ownerMob = await metrics(mob);
  notes.owner390bookings = {
    scrollWidth: ownerMob.scrollWidth,
    bodyScrollWidth: ownerMob.bodyScrollWidth,
    overflow: ownerMob.scrollWidth > 390,
    jargon: visibleEnglishJargon(ownerMob.bodyText),
    clipped: ownerMob.controls.filter((c) => c.clippedRight || c.zeroSize),
    bodyText: ownerMob.bodyText,
    bookingCount: await mob.locator('.hod-booking').count(),
  };

  // cancel first cancellable
  const cancelBtn = mob.locator('[data-hod-act="cancel"]').first();
  notes.hadCancel = (await cancelBtn.count()) > 0;
  if (notes.hadCancel) {
    const cancelledId = await cancelBtn.getAttribute('data-id');
    notes.cancelledId = cancelledId;
    await cancelBtn.click();
    await pause(900);
    await shot(mob, '12-clicked-cancel-booking-390');
    notes.afterCancelText = await mob.locator('body').innerText();
  }

  // reschedule remaining
  const reschedBtn = mob.locator('[data-hod-act="reschedule"]').first();
  notes.hadReschedule = (await reschedBtn.count()) > 0;
  if (notes.hadReschedule) {
    await reschedBtn.click();
    await pause(1200);
    await shot(mob, '13-opened-reschedule-modal-390');
    const pick = mob.locator('[data-hod-pick]').first();
    if ((await pick.count()) > 0) {
      await pick.click();
      await pause(400);
      await shot(mob, '14-picked-reschedule-slot-390');
      const save = mob.locator('[data-hod-do-reschedule]');
      if ((await save.count()) > 0) {
        await save.click();
        await pause(900);
        await shot(mob, '15-saved-reschedule-390');
        notes.afterRescheduleText = (await mob.locator('body').innerText()).slice(0, 1500);
      }
    } else {
      notes.rescheduleNoSlots = await mob.locator('.hod-modal, .hod-empty').innerText().catch(() => '');
    }
  }

  const availTab = mob.getByRole('button', { name: 'Disponibilitate' });
  await availTab.click();
  await pause(700);
  await shot(mob, '16-opened-owner-availability-390');
  const availM = await metrics(mob);
  notes.owner390avail = {
    scrollWidth: availM.scrollWidth,
    overflow: availM.scrollWidth > 390,
    jargon: visibleEnglishJargon(availM.bodyText),
    clipped: availM.controls.filter((c) => c.clippedRight || c.zeroSize),
    bodyText: availM.bodyText,
  };

  // edit weekly: uncheck Sunday if checked (already closed) — toggle Saturday open then save
  const saturday = mob.locator('li[data-weekday="6"] [data-hod-open]');
  if ((await saturday.count()) > 0) {
    const checked = await saturday.isChecked();
    notes.saturdayWasOpen = checked;
    if (!checked) await saturday.check();
    else await saturday.uncheck();
    await pause(200);
  }
  const saveWeekly = mob.locator('[data-hod-save-weekly]');
  if ((await saveWeekly.count()) > 0) {
    await saveWeekly.click();
    await pause(800);
    await shot(mob, '17-clicked-save-weekly-availability-390');
    notes.afterWeeklySave = (await mob.locator('[data-hod-flash]').innerText().catch(() => '')) || '';
  }

  // add blackout on next Monday-ish date: use a date 3 days out
  const ovDate = new Date();
  ovDate.setDate(ovDate.getDate() + 3);
  const ymd = `${ovDate.getFullYear()}-${String(ovDate.getMonth() + 1).padStart(2, '0')}-${String(ovDate.getDate()).padStart(2, '0')}`;
  notes.blackoutDate = ymd;
  const dateInput = mob.locator('[data-hod-ov-date]');
  if ((await dateInput.count()) > 0) {
    await dateInput.fill(ymd);
    const noteInp = mob.locator('[data-hod-ov-note]');
    if ((await noteInp.count()) > 0) await noteInp.fill('zi liberă QA');
    await mob.locator('[data-hod-add-ov]').click();
    await pause(900);
    await shot(mob, '18-added-blackout-date-override-390');
    notes.afterBlackout = (await mob.locator('body').innerText()).slice(0, 2000);
  }

  const svcTab = mob.getByRole('button', { name: 'Servicii' });
  await svcTab.click();
  await pause(500);
  await shot(mob, '19-opened-owner-services-390');
  const svcM = await metrics(mob);
  notes.owner390services = {
    scrollWidth: svcM.scrollWidth,
    overflow: svcM.scrollWidth > 390,
    jargon: visibleEnglishJargon(svcM.bodyText),
    bodyText: svcM.bodyText,
  };

  // widget after blackout
  await desk.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'networkidle', timeout: 25000 });
  await desk.waitForSelector('.hnb__svc, [data-hnb-error]', { timeout: 15000 });
  await pause(600);
  const dayBtns = desk.locator('.hnb__day');
  const dayN = await dayBtns.count();
  let blackoutDayHit = null;
  for (let i = 0; i < dayN; i++) {
    const d = await dayBtns.nth(i).getAttribute('data-date');
    if (d === ymd) {
      await dayBtns.nth(i).click();
      await pause(400);
      blackoutDayHit = {
        date: d,
        empty: await desk.locator('.hnb__empty').innerText().catch(() => ''),
        slots: await desk.locator('.hnb__slot').count(),
      };
      break;
    }
  }
  notes.blackoutDayHit = blackoutDayHit;
  await shot(desk, '20-opened-widget-after-blackout-day');

  // ---- 3. Email harness via sqlite ----
  const outbox = sqliteQuery(
    `SELECT id, customer_id, site_id, booking_id, template_key, recipient_email, subject,
            booking_status_snapshot, manage_link_present, status, attempt_count, provider_name,
            provider_message_id, last_error, body_text, body_html, created_at, sent_at
     FROM calendar_email_outbox ORDER BY created_at ASC`
  );
  notes.outbox = {
    error: outbox.error || null,
    count: outbox.rows.length,
    rows: outbox.rows.map((r) => ({
      id: r.id,
      template_key: r.template_key,
      recipient_email: r.recipient_email,
      subject: r.subject,
      booking_status_snapshot: r.booking_status_snapshot,
      manage_link_present: r.manage_link_present,
      status: r.status,
      provider_name: r.provider_name,
      last_error: r.last_error,
      body_text: r.body_text,
      body_html: (r.body_html || '').slice(0, 2000),
      secretsText: secretish(JSON.stringify(r)),
    })),
  };

  const manageUrls = [];
  for (const r of outbox.rows) {
    const m = String(r.body_text || '').match(/https?:\/\/\S+/g) || [];
    const h = String(r.body_html || '').match(/https?:\/\/[^"'\\\s]+/g) || [];
    for (const u of [...m, ...h]) manageUrls.push(u);
  }
  notes.manageUrls = [...new Set(manageUrls)];

  // open first manage link
  if (notes.manageUrls.length) {
    const u = notes.manageUrls[0];
    const res = await desk.goto(u, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => ({ error: String(e) }));
    await pause(400);
    await shot(desk, '21-opened-manage-link-from-email');
    notes.managePage = {
      url: u,
      status: res && res.status ? res.status() : null,
      title: await desk.title(),
      body: (await desk.locator('body').innerText().catch(() => '')).slice(0, 1200),
    };
  } else {
    notes.managePage = { url: null, body: 'no manage url in outbox' };
    await desk.goto(`${BASE}/calendar-native/manage?token=not-a-real-token`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    await pause(300);
    await shot(desk, '21-opened-manage-link-missing-route');
    notes.manageMissing = {
      status: null,
      title: await desk.title(),
      body: (await desk.locator('body').innerText().catch(() => '')).slice(0, 800),
    };
  }

  // ---- 4. Outage: point widget API at a closed port ----
  await desk.goto(`${BASE}/calendar-native/widget/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
  await desk.waitForSelector('.hnb, [data-hidook-cal-native]', { timeout: 15000 });
  await pause(400);
  await desk.evaluate(() => {
    document.body.innerHTML =
      '<div id="hnb-root" data-hidook-cal-native data-customer-id="demo_customer_elena" data-site-id="demo_site_cabinet" data-api-base="http://127.0.0.1:9" data-brand="Cabinet Dr. Elena Pop" data-contact-phone="0722 111 222" data-contact-whatsapp="https://wa.me/40722111222" data-contact-email="elena@cabinet.ro"></div>';
    const s = document.createElement('script');
    s.src = '/calendar-native/widget/public-booking-widget.js';
    document.body.appendChild(s);
  });
  await desk.waitForSelector('[data-hnb-error], .hnb__svc', { timeout: 15000 }).catch(() => {});
  await pause(800);
  await shot(desk, '22-pointed-widget-api-at-dead-port-9');
  notes.outage = await desk.evaluate(() => {
    const err = document.querySelector('[data-hnb-error]');
    const ok = document.querySelector('[data-hnb-success]');
    return {
      errorText: err ? err.innerText : null,
      successText: ok ? ok.innerText : null,
      hasWhatsapp: !!document.querySelector('a[href*="wa.me"]'),
      hasTel: !!document.querySelector('a[href^="tel:"]'),
      body: document.body.innerText.slice(0, 1500),
    };
  });

  // ---- 5. Tenant isolation (API + dashboard cookie) ----
  const iso = {};
  const preview = await desk.request.post(`${BASE}/api/calendar-native/owner/preview-session`, {
    headers: { Accept: 'application/json' },
  });
  iso.previewStatus = preview.status();
  iso.previewBody = await preview.json().catch(() => null);
  const cookies = await desk.context().cookies();
  iso.cookieNames = cookies.map((c) => c.name);

  const ownerA = await desk.request.get(
    `${BASE}/api/calendar-native/owner/bookings?customerId=demo_customer_elena&siteId=demo_site_cabinet`,
    { headers: { Accept: 'application/json' } }
  );
  iso.ownerA = { status: ownerA.status(), body: await ownerA.json().catch(() => null) };

  const ownerB = await desk.request.get(
    `${BASE}/api/calendar-native/owner/bookings?customerId=tenant_B_other&siteId=site_B_other`,
    { headers: { Accept: 'application/json' } }
  );
  iso.ownerB = { status: ownerB.status(), body: await ownerB.json().catch(() => null) };

  const noAuth = await desk.context().request.get(
    `${BASE}/api/calendar-native/owner/bookings?customerId=demo_customer_elena&siteId=demo_site_cabinet`,
    { headers: { Accept: 'application/json', Cookie: '' } }
  ).catch(() => null);
  // Use a clean context for unauthenticated
  const anonCtx = await browser.newContext();
  const anonOwner = await anonCtx.request.get(
    `${BASE}/api/calendar-native/owner/bookings?customerId=demo_customer_elena&siteId=demo_site_cabinet`
  );
  iso.anonOwner = { status: anonOwner.status(), body: await anonOwner.json().catch(() => null) };

  const pubA = await anonCtx.request.get(
    `${BASE}/api/calendar-native/services?customerId=demo_customer_elena&siteId=demo_site_cabinet`
  );
  iso.pubA = { status: pubA.status(), body: await pubA.json().catch(() => null) };
  const pubB = await anonCtx.request.get(
    `${BASE}/api/calendar-native/services?customerId=tenant_B_other&siteId=site_B_other`
  );
  iso.pubB = { status: pubB.status(), body: await pubB.json().catch(() => null) };

  const pubList = await anonCtx.request.get(
    `${BASE}/api/calendar-native/owner/bookings?customerId=demo_customer_elena&siteId=demo_site_cabinet`
  );
  iso.publicTryingOwnerList = { status: pubList.status(), body: await pubList.json().catch(() => null) };

  const aBookingId =
    iso.ownerA.body && iso.ownerA.body.bookings && iso.ownerA.body.bookings[0]
      ? iso.ownerA.body.bookings[0].id
      : null;
  iso.aBookingId = aBookingId;
  if (aBookingId) {
    const crossCancel = await anonCtx.request.post(
      `${BASE}/api/calendar-native/owner/bookings/${aBookingId}/cancel`,
      { data: { customerId: 'tenant_B_other', siteId: 'site_B_other' } }
    );
    iso.anonCancel = { status: crossCancel.status(), body: await crossCancel.json().catch(() => null) };

    const crossCancelAsAbody = await desk.request.post(
      `${BASE}/api/calendar-native/owner/bookings/${aBookingId}/cancel`,
      { data: { customerId: 'tenant_B_other', siteId: 'site_B_other' } }
    );
    iso.sessionACancelAsB = {
      status: crossCancelAsAbody.status(),
      body: await crossCancelAsAbody.json().catch(() => null),
    };
  }

  // public bookings list must not exist
  const pubBookings = await anonCtx.request.get(
    `${BASE}/api/calendar-native/bookings?customerId=demo_customer_elena&siteId=demo_site_cabinet`
  );
  iso.publicGetBookings = {
    status: pubBookings.status(),
    bodyText: (await pubBookings.text()).slice(0, 400),
  };

  await anonCtx.close();
  notes.isolation = iso;

  // comparable: Calendly homepage (layout bar)
  try {
    await desk.goto('https://calendly.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await pause(1200);
    await shot(desk, '23-opened-comparable-calendly-homepage');
    notes.comparableCalendly = {
      title: await desk.title(),
      body: (await desk.locator('body').innerText()).slice(0, 600),
    };
  } catch (e) {
    notes.comparableCalendly = { error: String(e) };
  }

  await browser.close();

  const report = {
    sha: 'bb30226',
    base: BASE,
    dataDir: DATA_DIR,
    shots,
    findings,
    notes,
  };
  fs.writeFileSync(LOG, JSON.stringify(report, null, 2));
  console.log('WROTE', LOG);
  console.log('SHOTS', shots.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
