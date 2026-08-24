#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'builder/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'builder/app.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'builder/app.js'), 'utf8');
const metrics = {
  hasNewsreader: html.includes('Newsreader'),
  hasHeroStage: html.includes('hero-stage-stack'),
  hasChips: html.includes('catalog-chips'),
  hasHow: html.includes('id="cum-e"'),
  hasProof: html.includes('proof-row'),
  noBadge: !html.includes('hero-badge') && !html.includes('Builder + hosting'),
  noIndigoHtml: !html.includes('#5B5BD6') && !html.includes('#EEF2FF'),
  paperToken: /--bg:\s*#F3EFE8/i.test(css),
  accentToken: /--accent:\s*#9A4030/i.test(css),
  inkToken: /--ink:\s*#14120F/i.test(css),
  tallPreview: /template-card-preview[\s\S]*?height:\s*360px/.test(css),
  noIndigoCss: !css.includes('#5B5BD6') && !css.includes('#EEF2FF'),
  hasPopulateStage: js.includes('populateHeroStage'),
  hasCatalogFilter: js.includes('applyCatalogFilter'),
  editorOutlineForest: js.includes('#1E3A32'),
  // Mobile header CTA must beat .btn-primary display (S71-fix)
  headerCtaSpecificity: /\.app-header\s+(?:a\.)?header-cta[\s\S]{0,80}display:\s*none/.test(css)
    && /@media\s*\(\s*min-width:\s*640px\s*\)[\s\S]{0,200}\.app-header\s+(?:a\.)?header-cta/.test(css),
};
const outDir = path.join(root, '04-QA-Evidence/S71-remake');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'metrics-static.json'), JSON.stringify(metrics, null, 2));
console.log(JSON.stringify(metrics, null, 2));
const fails = Object.entries(metrics).filter(([, v]) => !v).map(([k]) => k);
if (fails.length) {
  console.error('STATIC VERIFY FAIL', fails);
  process.exit(1);
}
console.log('static metrics OK');
