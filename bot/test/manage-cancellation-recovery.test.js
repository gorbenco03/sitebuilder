'use strict';
// Execute the shipped visitor script: action failure must not erase loaded authority.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname,'../calendar-native/manage/manage.js'),'utf8');
const booking = {id:'booking-local',status:'confirmed',statusLabelRo:'confirmată',startUtc:'2030-04-15T08:00:00Z',endUtc:'2030-04-15T09:00:00Z',timezone:'Europe/Bucharest',serviceName:'Consultație locală',visitorName:'Vizitator local',minCancelHours:24};
class Element {
  constructor(tag) {this.tag=tag;this.children=[];this.attrs={};this.listeners={};this._text='';}
  set className(v){this.attrs.class=v;} get className(){return this.attrs.class||'';}
  set innerHTML(v){this.children=[];this._text=v;} get innerHTML(){return this._text;}
  set textContent(v){this._text=v;this.children=[];} get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ');}
  appendChild(n){this.children.push(n);return n;}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k];}
  addEventListener(k,v){this.listeners[k]=v;}
  focus(){this.focused=true;}
  querySelector(sel){return walk(this).find(n=>sel[0]==='#'?n.id===sel.slice(1):sel[0]==='.'?n.className.split(' ').includes(sel.slice(1)):sel.startsWith('[')?Object.hasOwn(n.attrs,sel.slice(1,-1)):false)||null;}
}
function walk(root){return root.children.flatMap(c=>[c,...walk(c)]);}
const settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r));};
async function page(responses) {
  const body=new Element('main'),sub=new Element('p');body.id='hm-body';sub.id='hm-sub';
  const root=new Element('html');root.appendChild(body);root.appendChild(sub);
  const calls=[];
  vm.runInNewContext(script, {document:{readyState:'complete',createElement:t=>new Element(t),querySelector:s=>root.querySelector(s)},location:{href:'http://local.invalid/calendar-native/manage?token=local-test-only-token'},URL,Intl,Date,window:{confirm:()=>true},fetch:async(url,opts)=>{calls.push({url,opts});const r=responses.shift();if(r instanceof Error)throw r;return{status:r.status,json:async()=>r.body};}});
  await settle();
  return {body,sub,calls,click:async sel=>{const n=body.querySelector(sel);assert.ok(n,sel);n.listeners.click();await settle();}};
}
const loaded=()=>({status:200,body:{ok:true,booking:{...booking}}});
for(const [name,response] of [
  ['policy denial',{status:400,body:{code:'WINDOW',error:'Intervalul minim înainte de programare a trecut — nu mai poți anula din link.'}}],
  ['server failure',{status:503,body:{error:'Nu am putut anula programarea. Încearcă din nou.'}}],
  ['network failure',new Error('offline')],
  ['malformed success',{status:200,body:{ok:true}}],
]) test('F21 '+name+' keeps actual loaded details and recovery instead of invalid-link screen',async()=>{
  const p=await page([loaded(),response]);
  await p.click('[data-hm-cancel]');
  assert.ok(p.body.querySelector('[data-hm-status]'),'loaded booking card survives');
  assert.equal(p.body.querySelector('[data-hm-status]').attrs['data-hm-status'],'confirmed');
  assert.match(p.body.textContent,/Consultație locală/);
  assert.match(p.body.textContent,/15 aprilie/);
  assert.doesNotMatch(p.sub.textContent,/Nu putem deschide/);
  assert.ok(p.body.querySelector('[role]'));
  assert.ok(p.body.querySelector('[data-hm-reload]'),'visible reload/recovery control');
  assert.match(p.body.textContent,/contactează/i);
  assert.doesNotMatch(p.body.textContent,/Programare anulată/);
  assert.ok(!p.body.querySelector('[data-hm-cancel]').disabled,'retry is not stuck disabled');
});
test('F21 authoritative cancellation response wins over previous confirmed state',async()=>{
  const p=await page([loaded(),{status:200,body:{ok:true,booking:{...booking,status:'cancelled',statusLabelRo:'anulată'}}}]);
  await p.click('[data-hm-cancel]');
  assert.equal(p.body.querySelector('[data-hm-status]').attrs['data-hm-status'],'cancelled');
  assert.match(p.body.textContent,/Programare anulată/);
  assert.equal(p.body.querySelector('[data-hm-cancel]'),null);
});
test('F21 invalid initial token remains generic and does not expose booking details',async()=>{
  const p=await page([{status:404,body:{error:'Link invalid sau expirat.'}}]);
  assert.equal(p.body.querySelector('[data-hm-status]'),null);
  assert.doesNotMatch(p.body.textContent,/Consultație locală|Vizitator local/);
  assert.match(p.sub.textContent,/Nu putem deschide/);
});
test('F21 genuine returned same-booking authority is retained on refusal, no success invented',async()=>{
  const p=await page([loaded(),{status:409,body:{error:'Starea programării s-a schimbat.',booking:{...booking,status:'cancelled',statusLabelRo:'anulată'}}}]);
  await p.click('[data-hm-cancel]');
  assert.equal(p.body.querySelector('[data-hm-status]').attrs['data-hm-status'],'cancelled');
  assert.doesNotMatch(p.body.textContent,/Programare anulată\. Intervalul/);
  assert.ok(p.body.querySelector('[data-hm-reload]'));
});
test('F21 reload after lost mutation response gets actual cancellation; failed reload keeps details',async()=>{
  const p=await page([loaded(),new Error('response lost'),new Error('offline'),{status:200,body:{ok:true,booking:{...booking,status:'cancelled',statusLabelRo:'anulată'}}}]);
  await p.click('[data-hm-cancel]');
  await p.click('[data-hm-reload]');
  assert.equal(p.body.querySelector('[data-hm-status]').attrs['data-hm-status'],'confirmed');
  await p.click('[data-hm-reload]');
  assert.equal(p.body.querySelector('[data-hm-status]').attrs['data-hm-status'],'cancelled');
});
