// Proper deep-JSON-nesting DoS probe: builds the raw JSON text directly
// (no client-side recursive object + JSON.stringify, which stack-overflows
// on the CLIENT before anything is even sent) and sends it as the raw
// request body, to see how the SERVER's JSON.parse handles it.
import { bootServer } from './_harness.mjs';

async function main() {
  const { base, close } = await bootServer();
  try {
    const r1 = await fetch(base + '/api/auth/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'deepjson@example.test' }) });
    const j1 = await r1.json();
    const verifyUrl = new URL(j1.devLink, base);
    const r2 = await fetch(base + verifyUrl.pathname + verifyUrl.search, { redirect: 'manual' });
    const cookie = /hb_session=([^;]+)/.exec(r2.headers.get('set-cookie'))[0];

    for (const depth of [1000, 5000, 50000, 200000]) {
      const body = '{"templateId":"portfolio","config":' + '{"a":'.repeat(depth) + '1' + '}'.repeat(depth) + '}';
      const start = Date.now();
      let status, textSnippet, threw;
      try {
        const r = await fetch(base + '/api/draft', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body,
        });
        status = r.status;
        textSnippet = (await r.text()).slice(0, 200);
      } catch (e) { threw = e.message; }
      const ms = Date.now() - start;
      console.log(`depth=${depth} bodyBytes=${body.length} -> status=${status} threw=${threw} took=${ms}ms text=${textSnippet}`);
    }

    // Confirm server is still alive/responsive after all that
    const health = await fetch(base + '/health');
    console.log('server still alive after deep-JSON probes:', health.status === 200);
  } finally {
    await close();
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
