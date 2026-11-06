'use strict';
// Real loopback product, native UI actions; no provider calls or preloaded login.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startLocalServer } = require('../../04-QA-Evidence/Implementation-2026-11-05/assembled-gallery/local-server.cjs');
const OUT = path.resolve('04-QA-Evidence/Implementation-2026-11-05/painted-layout-recovery', process.env.PAINTED_PHASE || 'green');
const red = process.env.PAINTED_PHASE === 'red';
test('Selected block identity and actions never overlap; dashboard heading paints fully', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const log = console.log;
  console.log = (...args) => log(...args.map(x => typeof x === 'string' ? x.replace(/"devLink":"[^"]+"/g, '"devLink":"[local sign-in link redacted]"') : x));
  const owned = await startLocalServer();
  const browser = await chromium.launch();
  const records = [], errors = [];
  const check = (name, ok, detail) => { records.push({ name, ok, detail }); };
  const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ records, errors }, null, 2));
  async function shot(p, action) { await p.screenshot({ path: path.join(OUT, action + '.png') }); }
  async function select(p, index) {
    if (!await p.locator('#block-list li').nth(index).isVisible()) await p.locator('#tab-page').click();
    await p.locator('#block-list li').nth(index).click();
    await settled(p);
  }
  async function settled(p) {
    // Observe native smooth-scroll completion; never replace its destination.
    let last=null,stable=0;
    for(let i=0;i<40&&stable<3;i++) {
      const y=await p.locator('#canvas').evaluate(f=>f.contentWindow.scrollY);
      stable=y===last?stable+1:0;last=y;await p.waitForTimeout(50);
    }
    assert.equal(stable,3,'selection scroll must settle before measuring or clicking');
  }
  async function geometry(p, name, capture = false) {
    await p.waitForTimeout(150);
    const g = await p.frameLocator('#canvas').locator('.blk.is-sel').evaluate(el => {
      const label = el.querySelector('.ed-label'), tools = el.querySelector('.ed-tools');
      const rect = e => { const r = e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; };
      const l = rect(label), t = tools ? rect(tools) : null;
      const range = document.createRange(); range.selectNodeContents(label);
      const text = [...range.getClientRects()].map(r => ({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));
      const overlap = (a,b) => a.left < b.right-.5 && b.left < a.right-.5 && a.top < b.bottom-.5 && b.top < a.bottom-.5;
      const add = el.querySelector('.ed-add'), a = add ? rect(add) : null;
      return { label:label.textContent, add:a, addOverlap:a&&(overlap(l,a)||(t&&overlap(t,a))), chrome:label.parentElement.classList.contains('ed-chrome')?rect(label.parentElement):null, l, t, text, overlap:t && overlap(l,t), clipped:text.some(r=>r.left<l.left-.5||r.right>l.right+.5||r.top<l.top-.5||r.bottom>l.bottom+.5), buttons:[...el.querySelectorAll('.ed-tools button')].map(b=>({text:b.textContent,rect:rect(b)})), width:innerWidth, z:getComputedStyle(label).zoom };
    });
    check(name, !g.overlap && !g.addOverlap && !g.clipped && (!g.chrome||Math.abs(g.chrome.width-g.width)<1) && g.l.left >= -.5 && g.l.right <= g.width+.5 && g.buttons.every(b=>b.rect.left>=-.5&&b.rect.right<=g.width+.5), g);
    if (capture) await shot(p, name);
  }
  async function blankBodyFixture(p) {
    // Blank stays empty until this oracle explicitly inserts its action fixtures.
    assert.deepEqual(await p.evaluate(()=>site.pages.map(({name,blocks})=>({name,blocks}))),
      [{name:'Acasă',blocks:[]}], 'new Blank has one empty Acasă page before explicit Add');
    for(const choice of [{type:'hero',variant:'centered'}, {type:'text',variant:'left'}]) {
      const insert=p.locator('.addcard[data-type="'+choice.type+'"][data-v="'+choice.variant+'"] [data-choice=insert]');
      if(!await insert.isVisible())await p.locator('#tab-add').click();
      await insert.click();
    }
    assert.deepEqual(await p.evaluate(()=>curPage().blocks.map(({type,variant})=>({type,variant}))),
      [{type:'hero',variant:'centered'}, {type:'text',variant:'left'}],
      'layout actions require explicitly added hero then text');
  }
  async function dashboard(p, name) {
    await p.locator('.dashboard-header h2').waitFor();
    const g = await p.locator('.dashboard-header').evaluate(el => {
      const h=el.querySelector('h2'),b=el.querySelector('button'),r=h.getBoundingClientRect();
      const range=document.createRange();range.selectNodeContents(h);
      return {text:h.textContent,scroll:h.scrollWidth,client:h.clientWidth,overflow:getComputedStyle(h).overflow,textOverflow:getComputedStyle(h).textOverflow,rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},textRects:[...range.getClientRects()].map(x=>({left:x.left,right:x.right,top:x.top,bottom:x.bottom})),button:b?.textContent};
    });
    check(name,g.text.trim()==='Site-urile mele' && g.scroll<=g.client+1 && g.textRects.every(r=>r.right<=g.rect.right+.5&&(g.overflow==='visible'||r.bottom<=g.rect.bottom+.5)),g);
    await shot(p,name);
  }
  try {
    const c=await browser.newContext({viewport:{width:320,height:1000},hasTouch:true,locale:'ro-RO'});
    await c.route('**/*',q=>{const u=new URL(q.request().url());return u.origin===owned.base||!/^https?:$/.test(u.protocol)?q.continue():q.abort();});
    const p=await c.newPage();p.setDefaultTimeout(18000);
    await p.goto(owned.base+'/app/');await p.locator('#hb-cookie-accept').click();
    await p.locator('.btn-start-tpl[data-id=gol]').click();await p.locator('#who-skip').click();
    await blankBodyFixture(p);
    for(const width of [320,390,1280]) {
      await p.setViewportSize({width,height:1000});await select(p,1);
      await geometry(p,'select-blank-section-inspector-open-'+width,true);
      if(width<768) {
        await p.locator('#insp-close').click();
        check('close-inspector-deselects-'+width,await p.frameLocator('#canvas').locator('.blk.is-sel').count()===0);
        await shot(p,'close-inspector-deselects-'+width);
      }
    }
    await p.setViewportSize({width:320,height:1000});
    await p.locator('#publish').click();await p.locator('#pub-email').fill('painted-layout@example.invalid');await p.locator('#pub-auth button[type=submit]').click();
    const [auth]=await Promise.all([c.waitForEvent('page'),p.locator('#pub-devlink').click()]);await auth.waitForURL(/#dashboard$/);await auth.close();
    await p.waitForFunction(()=>!document.querySelector('#pub-go').disabled&&document.activeElement.id==='pub-go');await p.locator('#pub-close').click();
    await p.getByRole('link',{name:/Site-urile mele/}).click();await p.locator('.site-card').waitFor();
    for(const width of [320,390,1280]) {await p.setViewportSize({width,height:1000});await dashboard(p,'open-normal-dashboard-'+width);}
    await p.locator('.dashboard-header a').click();
    await p.locator('.btn-start-tpl[data-id=gol]').waitFor({state:'visible'});
    check('Site nou reaches actual design selection',await p.locator('.btn-start-tpl[data-id=gol]').isVisible());
    if(!red) {
      // Exercise the actual floating buttons, both counter-scaled canvas modes,
      // shared identities, a longest library identity and the shortest block.
      const edit=await p.locator('.site-card a[href*="/app/blocks/?site="]').first().getAttribute('href');
      await p.goto(new URL(edit,owned.base).href);
      await p.locator('#canvas').waitFor();
      await p.waitForFunction(()=>document.getElementById('saved').textContent==='Salvat în cont');
      const siteJSON=()=>p.evaluate(()=>JSON.stringify(site));
      const blocks=()=>p.evaluate(()=>curPage().blocks.map(b=>({id:b.id,type:b.type,variant:b.variant})));
      async function device(id) {
        if(!await p.locator(id).isVisible())await p.locator('#tools-toggle').click();
        await p.locator(id).click();
        if(await p.locator('#tools-toggle').getAttribute('aria-expanded')==='true')await p.locator('#tools-toggle').click();
      }
      async function undo() {
        if(!await p.locator('#undo').isVisible())await p.locator('#tools-toggle').click();
        await p.locator('#undo').click();
        if(await p.locator('#tools-toggle').getAttribute('aria-expanded')==='true')await p.locator('#tools-toggle').click();
      }
      const toolbar=()=>p.frameLocator('#canvas').locator('.blk.is-sel .ed-tools');
      async function inlineAction(act) {
        await settled(p);
        const button=toolbar().locator('[data-act='+act+']');
        if(p.viewportSize().width<768)await button.tap();else await button.click();
        await settled(p);
      }
      for(const width of [320,390,1280]) {
        await p.setViewportSize({width,height:1000});
        for(const mode of ['mobile','desktop']) {
          await device('#dev-'+mode);
          for(const index of [0,1,(await p.locator('#block-list li').count())-1]) {
            await select(p,index);
            await geometry(p,'select-shared-or-section-'+index+'-'+mode+'-'+width,true);
          }
        }
        await device('#dev-mobile');await select(p,1);
        const initial=await siteJSON();const original=await blocks();
        check('all six floating actions retained-'+width,await toolbar().locator('button').count()===6);
        const variant=original[0].variant;
        await inlineAction('variant');
        check('native Aspect changes selected block-'+width,(await blocks())[0].variant!==variant);
        await geometry(p,'click-inline-aspect-'+width,true);
        await undo();await select(p,1);
        await inlineAction('down');
        check('native move down-'+width,(await blocks())[1].id===original[0].id);
        await inlineAction('up');
        check('native move up-'+width,(await blocks())[0].id===original[0].id);
        await inlineAction('dup');
        check('native duplicate-'+width,(await blocks()).length===original.length+1);
        await geometry(p,'click-inline-duplicate-'+width);
        await inlineAction('del');
        check('native delete-'+width,(await blocks()).length===original.length);
        await undo();
        check('undo delete restores duplicate-'+width,(await blocks()).length===original.length+1);
        await undo();
        check('undo duplicate restores exact site-'+width,await siteJSON()===initial);
        // Select from the canvas without rebuilding the in-place editable text.
        await p.frameLocator('#canvas').locator('.blk').nth(1).locator('[data-f]').first().click();
        await p.keyboard.press('Escape');
        check('canvas selection has one chrome per block-'+width,await p.frameLocator('#canvas').locator('.blk').evaluateAll(ns=>ns.every(n=>n.querySelectorAll(':scope > .ed-chrome').length===1)));
        await select(p,1);await geometry(p,'canvas-reselection-'+width);
      }
      // Native HTML drag uses a desktop pointer context, not touch emulation.
      const desktop=await browser.newContext({viewport:{width:1280,height:1000},locale:'ro-RO'});
      await desktop.route('**/*',q=>{const u=new URL(q.request().url());return u.origin===owned.base||!/^https?:$/.test(u.protocol)?q.continue():q.abort();});
      const dp=await desktop.newPage();dp.setDefaultTimeout(18000);
      await dp.goto(owned.base+'/app/');await dp.locator('#hb-cookie-accept').click();await dp.locator('.btn-start-tpl[data-id=gol]').click();await dp.locator('#who-skip').click();
      await blankBodyFixture(dp);
      await select(dp,1);
      const beforeDrag=await dp.evaluate(()=>curPage().blocks.map(b=>b.id));
      await dp.locator('#canvas').evaluate(f=>{
        f.contentWindow.paintedDragEvents=[];
        for(const type of ['dragstart','dragover','drop','dragend'])f.contentDocument.addEventListener(type,e=>f.contentWindow.paintedDragEvents.push({type,target:e.target.className,id:e.target.closest('.blk')?.dataset.id,x:e.clientX,y:e.clientY,prevented:e.defaultPrevented}),false);
      });
      await dp.frameLocator('#canvas').locator('.ed-drag').dragTo(dp.frameLocator('#canvas').locator('.blk').last(),{targetPosition:{x:40,y:40}});
      await settled(dp);
      const dragEvents=await dp.locator('#canvas').evaluate(f=>f.contentWindow.paintedDragEvents);
      await shot(dp,'native-desktop-drag-handle-to-footer-1280');
      check('native desktop canvas drag changes block order',await dp.evaluate(first=>curPage().blocks[0].id!==first,beforeDrag[0]),{before:beforeDrag,after:await dp.evaluate(()=>curPage().blocks.map(b=>b.id)),events:dragEvents});
      await dp.locator('#undo').click();
      check('native desktop drag undo restores exact order',JSON.stringify(beforeDrag)===await dp.evaluate(()=>JSON.stringify(curPage().blocks.map(b=>b.id))));
      await select(dp,1);
      const oldVariant=await dp.evaluate(()=>curPage().blocks[0].variant);
      let keyboardReached=false;
      for(let i=0;i<200;i++) {
        await dp.keyboard.press('Tab');
        if(await dp.locator('#canvas').evaluate(f=>f.contentDocument.activeElement?.dataset.act==='variant')) {keyboardReached=true;break;}
      }
      check('inline Aspect reachable by native keyboard Tab',keyboardReached);
      await dp.keyboard.press('Enter');
      check('native keyboard Enter activates inline Aspect',await dp.evaluate(v=>curPage().blocks[0].variant!==v,oldVariant));
      await desktop.close();
      const longest=await p.evaluate(()=>Object.entries(BLOCKS).filter(([,d])=>!d.shared).flatMap(([type,d])=>Object.entries(d.variants).map(([variant,v])=>({type,variant,label:d.label+' · '+v}))).sort((a,b)=>b.label.length-a.label.length)[0]);
      for(const choice of [longest,{type:'spacer',variant:'line',label:'Separator · Linie'}]) {
        await p.locator('#tab-add').click();
        await p.locator('.addcard[data-type="'+choice.type+'"][data-v="'+choice.variant+'"] [data-choice=insert]').click();
        check('library inserts chosen actual block '+choice.label,(await blocks()).at(-1).type===choice.type,longest);
        for(const width of [320,390,1280]) {
          await p.setViewportSize({width,height:1000});
          for(const mode of ['mobile','desktop']) {
            await device('#dev-'+mode);await select(p,(await p.locator('#block-list li').count())-2);
            await geometry(p,'select-library-'+choice.type+'-'+mode+'-'+width,true);
          }
        }
      }
      for(const width of [320,390]) {
        for(const height of [844,568]) {
          await p.setViewportSize({width,height});
          await device('#dev-desktop');await select(p,(await p.locator('#block-list li').count())-2);
          await geometry(p,'select-short-block-scaled-'+width+'x'+height,true);
          const shell=await p.evaluate(()=>{const f=document.getElementById('frame-wrap').getBoundingClientRect(),i=document.getElementById('inspector').getBoundingClientRect();return {frameBottom:f.bottom,inspectorTop:i.top};});
          check('canvas reserves sheet space-'+width+'x'+height,shell.frameBottom<=shell.inspectorTop,shell);
        }
      }
      await p.setViewportSize({width:320,height:1000});await select(p,1);
      const unchanged=await siteJSON();
      await p.frameLocator('#canvas').locator('.blk.is-sel .ed-label').evaluate(el=>{el.textContent+=' · Identitate lungă pentru verificarea înfășurării pe mai multe rânduri';});
      await geometry(p,'stress-multiline-editor-label-not-saved-content-320',true);
      check('multiline stress does not change saved site',await siteJSON()===unchanged);
      await select(p,1);
      await p.frameLocator('#canvas').locator('.blk.is-sel [data-act=add]').tap();
      check('inline add action still opens block library',await p.locator('#library').isVisible());
      await p.locator('#lib-close').click();
      await p.getByRole('link',{name:/Site-urile mele/}).click();await p.locator('.dashboard-header a').click();
      await p.locator('.btn-start-tpl[data-id=gol]').waitFor({state:'visible'});
      const ids=await p.locator('.btn-start-tpl').evaluateAll(ns=>[...new Set(ns.map(n=>n.dataset.id))]);
      check('all 13 starter designs available',ids.length===13,ids);
      for(const id of ids) {
        await p.goto(owned.base+'/app/');
        if(!await p.locator('.btn-start-tpl[data-id="'+id+'"]').isVisible())await p.locator('#catalog-expand').click();
        await p.locator('.btn-start-tpl[data-id="'+id+'"]').click();await p.locator('#who-skip').click();
        if(id==='gol')await blankBodyFixture(p);
        for(const width of [320,390,1280]) {
          await p.setViewportSize({width,height:1000});await select(p,1);
          await geometry(p,'select-'+id+'-first-section-'+width);
          if(width<768) {
            await p.locator('#insp-close').click();
            check('close-inspector-'+id+'-'+width,await p.frameLocator('#canvas').locator('.blk.is-sel').count()===0);
          }
        }
      }
    }
    await c.close();
  } catch(e) { errors.push(e.stack); }
  finally { await browser.close();await owned.close();save();console.log=log; }
  console.log(JSON.stringify({checks:records.length,failed:records.filter(r=>!r.ok).map(r=>r.name),errors}));
  assert.deepEqual(errors,[]);
  assert.equal(records.filter(r=>!r.ok).length,0,'painted identity/heading layout failures; see results.json');
});
