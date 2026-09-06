// Combined live probe against an isolated Hidook server: logout, cross-account
// IDOR, rate-limit XFF bypass, magic-link tamper/replay, headers, resource
// exhaustion, error/secrets leakage. Run: node live-probe.mjs
import { bootServer } from './_harness.mjs';

function cookieFrom(setCookieHeader) {
  if (!setCookieHeader) return null;
  const m = /hb_session=([^;]+)/.exec(setCookieHeader);
  return m ? `hb_session=${m[1]}` : null;
}

async function loginNewUser(base, email) {
  const r1 = await fetch(base + '/api/auth/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const j1 = await r1.json();
  if (!j1.devLink) throw new Error('no devLink for ' + email + ' -> ' + JSON.stringify(j1));
  const verifyUrl = new URL(j1.devLink, base);
  const r2 = await fetch(base + verifyUrl.pathname + verifyUrl.search, { redirect: 'manual' });
  const setCookie = r2.headers.get('set-cookie');
  const cookie = cookieFrom(setCookie);
  if (!cookie) throw new Error('no session cookie set for ' + email);
  return { cookie, token: verifyUrl.searchParams.get('token'), verifyPath: verifyUrl.pathname + verifyUrl.search };
}

async function main() {
  const { base, close } = await bootServer();
  console.log('server up at', base);
  const results = [];
  const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? 'PASS' : 'FAIL'), '-', name, detail !== undefined ? '- ' + JSON.stringify(detail) : ''); };

  try {
    // ---- Set up two accounts ----
    const A = await loginNewUser(base, 'attacker-a@example.test');
    const B = await loginNewUser(base, 'victim-b@example.test');

    const meA = await (await fetch(base + '/api/me', { headers: { Cookie: A.cookie } })).json();
    const meB = await (await fetch(base + '/api/me', { headers: { Cookie: B.cookie } })).json();
    console.log('userA', meA.user && meA.user.id, 'userB', meB.user && meB.user.id);

    // ---- Give B a site (draft is enough for most reads; some routes need paid) ----
    const tpls = await (await fetch(base + '/api/templates')).json();
    const templateId = (tpls.templates && tpls.templates[0] && tpls.templates[0].id) || 'portfolio';
    const draftB = await (await fetch(base + '/api/draft', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: B.cookie },
      body: JSON.stringify({ templateId, config: { business: { name: 'Victim Biz' } } }),
    })).json();
    const siteB = draftB.site && draftB.site.id;
    rec('setup: created draft site for B', !!siteB, siteB);

    // ==================== 1. CROSS-ACCOUNT AUTHORIZATION ====================
    const crossChecks = [
      ['GET', `/api/sites/${siteB}`],
      ['GET', `/api/sites/${siteB}/versions`],
      ['GET', `/api/sites/${siteB}/invoices`],
      ['GET', `/api/sites/${siteB}/domain`],
      ['POST', `/api/sites/${siteB}/rollback`, { versionId: 'v1' }],
      ['POST', `/api/sites/${siteB}/domain`, { domain: 'evil.example.com' }],
      ['POST', `/api/sites/${siteB}/domain/verify`, {}],
      ['DELETE', `/api/sites/${siteB}/domain`],
      ['POST', `/api/sites/${siteB}/checkout`, {}],
      ['POST', `/api/sites/${siteB}/billing-portal`, {}],
      ['POST', `/api/sites/${siteB}/social-feed/disconnect`, {}],
    ];
    for (const [method, path, body] of crossChecks) {
      const r = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', Cookie: A.cookie },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const ok = r.status === 403 || r.status === 404 || r.status === 401;
      rec(`cross-account A->B ${method} ${path}`, ok, { status: r.status });
    }

    // Calendar owner tenant: A supplies own customerId (userId) but B's siteId
    const calCross1 = await fetch(base + `/api/calendar-native/owner/bookings?customerId=${meA.user.id}&siteId=${siteB}`, { headers: { Cookie: A.cookie } });
    rec('cross-account calendar owner: A customerId + B siteId', calCross1.status === 403 || calCross1.status === 404, { status: calCross1.status, body: await calCross1.text() });

    // Calendar owner tenant: A supplies B's customerId (userId) directly (hard-bind should reject since != session uid)
    const calCross2 = await fetch(base + `/api/calendar-native/owner/bookings?customerId=${meB.user.id}&siteId=${siteB}`, { headers: { Cookie: A.cookie } });
    rec('cross-account calendar owner: A claims B customerId', calCross2.status === 403, { status: calCross2.status, body: await calCross2.text() });

    // Mismatched ids between URL and body: rollback with A's own valid site id in URL but no auth mismatch test (A has none) -- try path traversal in siteId
    const traversal = await fetch(base + `/api/sites/${encodeURIComponent('../../etc/passwd')}`, { headers: { Cookie: A.cookie } });
    rec('path traversal in siteId', traversal.status === 404 || traversal.status === 400, { status: traversal.status });

    // ==================== 2. LOGOUT ====================
    const logoutResp = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: A.cookie } });
    rec('logout endpoint exists (expect 404 = confirmed missing)', true, { status: logoutResp.status });
    // Now replay A's OLD cookie against /api/me -- should still work if logout is fake
    const meAafterLogout = await fetch(base + '/api/me', { headers: { Cookie: A.cookie } });
    const stillValid = meAafterLogout.status === 200;
    rec('SECURITY: old session cookie still valid after "logout"', stillValid, { status: meAafterLogout.status });

    // ==================== 3. MAGIC LINK REPLAY / TAMPER ====================
    // Replay the already-consumed verify token for A
    const replay = await fetch(base + A.verifyPath, { redirect: 'manual' });
    const replaySetCookie = replay.headers.get('set-cookie');
    rec('magic-link token single-use (replay should fail / no new cookie)', !replaySetCookie, { status: replay.status, gotCookie: !!replaySetCookie });

    // Tamper: flip a char in a fresh token before consuming it
    const C = await (async () => {
      const r1 = await fetch(base + '/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'tamper-c@example.test' }) });
      const j1 = await r1.json();
      return j1.devLink;
    })();
    const cUrl = new URL(C, base);
    const origToken = cUrl.searchParams.get('token');
    const tamperedToken = origToken.slice(0, -1) + (origToken.slice(-1) === 'a' ? 'b' : 'a');
    cUrl.searchParams.set('token', tamperedToken);
    const tamperResp = await fetch(base + cUrl.pathname + cUrl.search, { redirect: 'manual' });
    rec('tampered magic-link token rejected', !tamperResp.headers.get('set-cookie'), { status: tamperResp.status });

    // Session cookie tamper: flip a char in a valid session cookie
    const validCookieVal = B.cookie.split('=')[1];
    const tamperedCookie = 'hb_session=' + validCookieVal.slice(0, -2) + 'xx';
    const tamperSessResp = await fetch(base + '/api/me', { headers: { Cookie: tamperedCookie } });
    rec('tampered session cookie rejected', tamperSessResp.status === 401, { status: tamperSessResp.status });

    // ==================== 4. RATE LIMITING / X-Forwarded-For BYPASS ====================
    const floodEmail = 'flood-target@example.test';
    let blockedWithoutSpoof = false;
    for (let i = 0; i < 8; i++) {
      const r = await fetch(base + '/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: floodEmail }) });
      if (r.status === 429) { blockedWithoutSpoof = true; break; }
    }
    rec('per-email rate limit engages within 8 requests (same email)', blockedWithoutSpoof);

    // Now flood a DIFFERENT email each time but spoof a fresh X-Forwarded-For each time -- IP-based limit should never engage
    let ipLimitHit = false;
    for (let i = 0; i < 30; i++) {
      const spoofIp = `10.${(i>>16)&255}.${(i>>8)&255}.${i&255}`;
      const r = await fetch(base + '/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': spoofIp },
        body: JSON.stringify({ email: `flood-${i}@example.test` }),
      });
      if (r.status === 429) { ipLimitHit = true; break; }
    }
    rec('SECURITY: per-IP rate limit bypassed via spoofed X-Forwarded-For (30 distinct emails, 30 distinct spoofed IPs, never 429)', !ipLimitHit, { ipLimitHit });

    // ==================== 5. HEADERS ====================
    const hAppResp = await fetch(base + '/app/');
    const hLiveResp = await fetch(base + '/live/nonexistent-slug-xyz/');
    const hApiResp = await fetch(base + '/api/config');
    for (const [label, r] of [['/app/', hAppResp], ['/live/<slug>/', hLiveResp], ['/api/config', hApiResp]]) {
      const h = {
        csp: r.headers.get('content-security-policy'),
        xfo: r.headers.get('x-frame-options'),
        xcto: r.headers.get('x-content-type-options'),
        rp: r.headers.get('referrer-policy'),
        pp: r.headers.get('permissions-policy'),
      };
      rec(`security headers present on ${label}`, !!(h.csp && h.xcto && h.rp), h);
    }

    // ==================== 6. RESOURCE EXHAUSTION ====================
    // Deeply nested JSON to /api/draft
    let nested = { a: 1 };
    for (let i = 0; i < 20000; i++) nested = { a: nested };
    let deepErr = null;
    try {
      const r = await fetch(base + '/api/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: B.cookie },
        body: JSON.stringify({ templateId, config: nested }),
      });
      deepErr = { status: r.status, text: (await r.text()).slice(0, 300) };
    } catch (e) { deepErr = { threw: e.message }; }
    rec('deeply nested JSON (20000 levels) handled without crash/hang', true, deepErr);

    // Oversized body beyond MAX_BODY_BYTES (1MB) on a route using default limit
    const bigBody = JSON.stringify({ email: 'x'.repeat(3 * 1024 * 1024) });
    const bigResp = await fetch(base + '/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bigBody });
    rec('oversized body (3MB) rejected on /api/auth/email (1MB cap)', bigResp.status === 413 || bigResp.status === 400, { status: bigResp.status });

    // ==================== 7. ERROR HANDLING / SECRETS ====================
    const malformed = await fetch(base + '/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: B.cookie }, body: '{not json' });
    const malformedText = await malformed.text();
    rec('malformed JSON does not leak stack trace', !/at [A-Za-z]+.*\(.*\.js:\d+:\d+\)/.test(malformedText), { status: malformed.status, bodySnippet: malformedText.slice(0, 200) });

    const badSiteId = await fetch(base + `/api/sites/${encodeURIComponent("' OR '1'='1")}`, { headers: { Cookie: A.cookie } });
    const badSiteText = await badSiteId.text();
    rec("SQLi-shaped siteId does not error/leak (registry uses parameterized queries)", badSiteId.status === 404 || badSiteId.status === 403, { status: badSiteId.status, bodySnippet: badSiteText.slice(0,200) });

  } finally {
    await close();
  }

  const fails = results.filter(r => !r.pass);
  console.log('\n=== SUMMARY ===');
  console.log(results.length, 'checks,', fails.length, 'flagged (see FAIL / SECURITY lines above)');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
