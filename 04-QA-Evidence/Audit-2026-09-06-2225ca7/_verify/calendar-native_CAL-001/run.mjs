// Verify CAL-001: does bootServer() (no --experimental-sqlite flag, mirrors
// `node web.js` in the Dockerfile, which has no flag) blow up on a
// /api/calendar-native/* route with a 500 when node:sqlite is unavailable?
//
// Run with: node run.mjs                     (no flag -> simulates prod path)
// Compare:  node --experimental-sqlite run.mjs (flag -> simulates test path)
import { bootServer } from '/private/tmp/claude-502/-Users-Work-Desktop-sitebuilder/053e1940-1a1b-4ecd-a657-0a70815f9141/scratchpad/audit-harness.mjs';
import fs from 'node:fs';

const hasFlag = process.execArgv.includes('--experimental-sqlite');
console.log('execArgv:', process.execArgv, '| --experimental-sqlite present:', hasFlag);
console.log('node version:', process.version);

let srv;
let result;
try {
  srv = await bootServer();
  console.log('server booted at', srv.base);

  const r = await fetch(srv.base + '/api/calendar-native/services?customerId=demo&siteId=demo');
  const status = r.status;
  const text = await r.text();
  result = { route: '/api/calendar-native/services', status, bodySnippet: text.slice(0, 500) };
  console.log('GET', result.route, '->', status);
  console.log('body:', text.slice(0, 500));

  // Also try the static widget preview route mentioned in server.js comments.
  const r2 = await fetch(srv.base + '/calendar-native/widget/preview?customerId=demo&siteId=demo');
  const status2 = r2.status;
  const text2 = await r2.text();
  console.log('GET /calendar-native/widget/preview ->', status2);
  console.log('body2 (first 300):', text2.slice(0, 300));

  result.widgetPreviewStatus = status2;
  result.widgetPreviewSnippet = text2.slice(0, 300);
} catch (e) {
  result = { error: e.message, stack: e.stack };
  console.log('EXCEPTION during boot/fetch:', e.message);
} finally {
  if (srv) await srv.close();
}

fs.writeFileSync(
  new URL(hasFlag ? './result-with-flag.json' : './result-no-flag.json', import.meta.url),
  JSON.stringify({ hasFlag, nodeVersion: process.version, ...result }, null, 2)
);
