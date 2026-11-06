'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-revision-'));
process.env.SERVER_SECRET = crypto.randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
delete process.env.RESEND_API_KEY;
const reg = require('../registry.js');
const SB = require('../../builder/blocks/blocks.js');
const { startServer } = require('../server.js');
let server, base;
before(async () => { server = startServer({port:0}); await new Promise(r => server.once('listening',r)); base = `http://127.0.0.1:${server.address().port}`; process.env.PUBLIC_URL=base; });
after(async () => { await new Promise(r=>server.close(r)); });
async function login(label) {
 const res = await fetch(base+'/api/auth/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`${label}-${crypto.randomUUID()}@example.invalid`})});
 const {devLink}=await res.json();
 const verify=await fetch(new URL(devLink,base),{redirect:'manual'});
 const cookie=verify.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
 return (url,body)=>fetch(base+url,{method:body?'POST':'GET',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
}
for (const backend of ['json','sqlite']) test(`${backend}: conditional versions validate before mutation; ABA, competing writers, published versions`,()=>{
 const r=require(`../registry-${backend}.js`);
 const user=r.getOrCreateUserByEmail(`${backend}@example.invalid`);
 const site=r.createSite({userId:user.id,templateId:'blocks',slug:'revision-'+backend});
 const save=(value,expectedVersionId)=>r.saveVersion(site.id,{value},{expectedVersionId});
 const initial=save('base',null);
 for (const bad of [undefined,0,false,{},[], '']) assert.throws(()=>save('bad',bad),{code:'DRAFT_VERSION_INVALID'});
 const before=r.listVersions(site.id);
 assert.throws(()=>save('stale',null),{code:'DRAFT_VERSION_CONFLICT'});
 assert.deepEqual(r.listVersions(site.id),before);
 const a=save('a',initial.versionId);
 assert.throws(()=>save('b',initial.versionId),{code:'DRAFT_VERSION_CONFLICT'});
 const aba=r.saveVersion(site.id,{value:'base'},{published:true});
 assert.throws(()=>save('old local',a.versionId),{code:'DRAFT_VERSION_CONFLICT'});
 assert.deepEqual(r.getVersionConfig(site.id,aba.versionId),{value:'base'});
 assert.deepEqual(Object.keys(aba).sort(),['publishedAt','versionId']);
});
test('draft API exact revision acknowledgement, race protection, access and stable site/history state',async()=>{
 const c=await login('revision'),other=await login('foreign');
 const config=SB.defaultSite('gol');
 const created=await c('/api/draft',{templateId:'blocks',config}); assert.equal(created.status,200);
 const initial=await created.json(); assert.equal(typeof initial.versionId,'string');
 const id=initial.site.id;
 const read=await (await c('/api/sites/'+id)).json();
 assert.equal(read.versionId,initial.versionId);assert.deepEqual(read.config,JSON.parse(JSON.stringify(SB.normalizeSite(config))));
 const body={siteId:id,templateId:'blocks',config,expectedVersionId:read.versionId};
 const pair=await Promise.all([c('/api/draft',body),c('/api/draft',body)]);
 assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);
 const success=await pair.find(r=>r.status===200).json();
 const conflict=await pair.find(r=>r.status===409).json();assert.equal(conflict.code,'DRAFT_VERSION_CONFLICT');
 const snapshot=reg.getSite(id), versions=reg.listVersions(id);
 assert.equal((await c('/api/draft',body)).status,409);
 assert.deepEqual(reg.getSite(id),snapshot);assert.deepEqual(reg.listVersions(id),versions);
 assert.equal((await other('/api/draft',{...body,expectedVersionId:success.versionId})).status,403);
 assert.equal((await c('/api/draft',{...body,siteId:'missing'})).status,404);
 assert.equal((await c('/api/draft',{...body,templateId:'product-menu'})).status,409);
 for(const expectedVersionId of [0,false,{},[], '']) assert.equal((await c('/api/draft',{...body,expectedVersionId})).status,422);
 assert.equal((await c('/api/draft',{templateId:'blocks',config,expectedVersionId:null})).status,422);
 assert.equal((await fetch(base+'/api/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,401);
 assert.equal((await (await c('/api/sites/'+id+'/versions')).json()).versions.length,0);
 // Legacy callers remain unconditional; GET followed by another writer cannot authorize stale conditional POST.
 const legacy=await (await c('/api/draft',{siteId:id,templateId:'blocks',config})).json();
 assert.notEqual(legacy.versionId,success.versionId);
 assert.equal((await c('/api/draft',{...body,expectedVersionId:success.versionId})).status,409);
 const latest=await (await c('/api/sites/'+id)).json(); assert.equal(latest.versionId,legacy.versionId);
 // Simulate pruning between list and exact config read: no mismatched config/revision response.
 const original=reg.getVersionConfig;
 reg.getVersionConfig=()=>null;
 try { assert.equal((await c('/api/sites/'+id)).status,409); } finally { reg.getVersionConfig=original; }
});
