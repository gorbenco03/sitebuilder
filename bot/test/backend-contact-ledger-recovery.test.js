'use strict';
// F19 direct HTTP bypass/no notifications and R2 request-scoped ledger scaling.
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-contact-ledger-'));
Object.assign(process.env, { DATA_DIR:data, NODE_ENV:'test', HIDOOK_TEST_PAY:'1', HIDOOK_ISOLATED_DEPLOY:'1', SERVER_SECRET:crypto.randomBytes(32).toString('hex'), CALENDAR_EMAIL_TRANSPORT:'memory' });
for (const k of ['RESEND_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','HIDOOK_FAKE_DEPLOY']) delete process.env[k];
const reg = require('../registry');
const ledger = require('../ledger');
const wp = require('../webpublish');
const email = require('../email');
const messages = require('../site-messages');
const {startServer} = require('../server');
let server, base, cookie, owner, notified = 0;
const send = email.sendResendEmail;
email.sendResendEmail = async () => { notified++; return {id:'local-notification'}; };
before(async () => {
  server = startServer({port:0});
  await new Promise(r => server.once('listening',r));
  base = 'http://127.0.0.1:' + server.address().port;
  process.env.PUBLIC_URL = base;
  const auth = await fetch(base+'/api/auth/email', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'contact-ledger-owner@example.com'})});
  const {devLink} = await auth.json();
  const verified = await fetch(devLink, {redirect:'manual'});
  cookie = verified.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  owner = reg.getOrCreateUserByEmail('contact-ledger-owner@example.com');
  notified = 0;
});
after(async () => {email.sendResendEmail=send; await new Promise(r=>server.close(r));});
function site(slug, user=owner) {
  const s = reg.createSite({userId:user.id, templateId:'blocks', slug, platform:'web'});
  reg.updateSite(s.id,{paid:true,status:'live'});
  return reg.getSite(s.id);
}
async function submit(slug, contact, website='') {
  return fetch(base+'/api/site-messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,contact,name:'Vizitator local',message:'O întrebare reală',website})});
}
async function inbox(s) {
  const r = await fetch(base+'/api/sites/'+s.id+'/messages',{headers:{Cookie:cookie}});
  assert.equal(r.status,200);
  return (await r.json()).messages;
}
test('F19: abc bypass is rejected by HTTP, cannot persist or notify, honeypot still drops',async()=>{
  const s=site('contact-http-recovery');
  const count=notified;
  const r=await submit(s.slug,'abc');
  assert.equal(r.status,400);
  const body=await r.json();
  assert.equal(body.code,'INVALID_CONTACT');
  assert.match(body.error,/telefon|email/);
  assert.deepEqual(await inbox(s),[]);
  assert.equal(notified,count);
  const hp=await submit(s.slug,'abc','https://spam.invalid');
  assert.equal(hp.status,200);
  assert.deepEqual(await inbox(s),[]);
  assert.equal(notified,count);
});
test('F19: rejects malformed, empty, truncated and impossible contacts without side effects',async()=>{
  const s=site('contact-invalid-matrix');
  const count=notified;
  for(const contact of ['', '   ', 'abc', '07123', '+0000000000', '+40 0712 345 678', '0722abc123456', '1234567890123456', 'a@', '@example.com', 'a@example..com', 'a b@example.com', 'a@example.com\r\nBcc:other@example.com', '+40 712 345 678'+' '.repeat(120)+'bad']) {
    const r=messages.createPublicMessage({slug:s.slug,contact,name:'Local',message:'Salut'});
    assert.equal(r.ok,false,JSON.stringify(contact));
    assert.equal(r.status,400);
  }
  assert.deepEqual(await inbox(s),[]);
  assert.equal(notified,count);
});
test('F19: preserves legacy email and usable local/international phone reply details',async()=>{
  const s=site('contact-valid-matrix');
  const cases=[['0721234567','0721234567'],[' 0712 345 678 ','0712345678'],['+40 (712) 345-678','+40712345678'],['0040 712 345 678','+40712345678'],['+44 20 7946 0958','+442079460958'],['001 202 555 0123','+12025550123'],['client+oferta@example.com','client+oferta@example.com']];
  for(const [contact,expected] of cases) {
    const r=await submit(s.slug,contact);
    assert.equal(r.status,200,contact+' '+await r.clone().text());
    assert.ok((await inbox(s)).some(m=>m.contact===expected),expected);
  }
  assert.equal((await inbox(s)).length,cases.length);
});
test('R2: dashboard reads ledger once for many owned sites, fresh per request, isolated and semantically identical',async()=>{
  const owned=Array.from({length:24},(_,i)=>site('ledger-owned-'+i));
  const other=reg.getOrCreateUserByEmail('ledger-other@example.com');
  const foreign=site('ledger-foreign',other);
  for(const s of [...owned,foreign]) {
    ledger.append({event:'invoice',siteId:s.id,status:'trial_started',ts:'2026-01-01T00:00:00Z'});
    ledger.append({event:'payment_failed',siteId:s.id,ts:'2026-02-01T00:00:00Z'});
    ledger.append({event:'invoice',siteId:s.id,kind:'renewal',ts:'2026-03-01T00:00:00Z'});
    ledger.append({event:'invoice',siteId:s.id,status:'paid',ts:'2026-04-01T00:00:00Z'});
  }
  const uncharged=site('ledger-only-trial');
  ledger.append({event:'invoice',siteId:uncharged.id,ts:'2026-05-01T00:00:00Z'});
  const read=ledger.read; let reads=0;
  ledger.read=()=>{reads++;return read();};
  try {
    const response=await fetch(base+'/api/sites',{headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    const {sites}=await response.json();
    assert.equal(reads,1,'one request-scoped ledger scan, independent of owned site count');
    assert.ok(!sites.some(s=>s.id===foreign.id));
    for(const s of owned) assert.equal(sites.find(x=>x.id===s.id).chargedAt,wp.getInvoiceHistory(s)[0].ts);
    assert.ok(!sites.find(s=>s.id===uncharged.id).chargedAt,'legacy trial is not payment');
    ledger.append({event:'invoice',siteId:owned[0].id,status:'paid',ts:'2026-06-01T00:00:00Z'});
    reads=0;
    const next=await (await fetch(base+'/api/sites',{headers:{Cookie:cookie}})).json();
    assert.equal(reads,1,'next request rereads, no stale process cache');
    assert.equal(next.sites.find(s=>s.id===owned[0].id).chargedAt,'2026-06-01T00:00:00Z');
    reads=0;
    const noAuth=await fetch(base+'/api/sites');
    assert.equal(noAuth.status,401);
    assert.equal(reads,0,'unauthorized caller cannot scan billing ledger');
  } finally {ledger.read=read;}
});
