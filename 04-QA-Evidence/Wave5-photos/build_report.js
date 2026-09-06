const fs = require('fs');

function parseCsv(path) {
  const lines = fs.readFileSync(path, 'utf8').trim().split('\n').slice(1);
  const map = new Map();
  for (const line of lines) {
    const [id, file, bytes, kib, w, h] = line.split(',');
    map.set(`${id}/${file}`, { bytes: Number(bytes), w: Number(w), h: Number(h) });
  }
  return map;
}

const before = parseCsv('/private/tmp/claude-502/before-full-audit.csv');
const after = parseCsv('/private/tmp/claude-502/after-full-audit.csv');

let rows = [];
let totalBefore = 0, totalAfter = 0;
let changedTotalBefore = 0, changedTotalAfter = 0;
for (const [key, b] of before) {
  const a = after.get(key);
  totalBefore += b.bytes;
  totalAfter += a.bytes;
  if (a.bytes !== b.bytes || a.w !== b.w || a.h !== b.h) {
    rows.push({ key, before: b, after: a });
    changedTotalBefore += b.bytes;
    changedTotalAfter += a.bytes;
  }
}

console.log('# Wave5-photos: re-encoded file table\n');
console.log('| file | before dims | before KiB | after dims | after KiB |');
console.log('|---|---|---|---|---|');
for (const r of rows.sort((x, y) => x.key.localeCompare(y.key))) {
  console.log(
    `| ${r.key} | ${r.before.w}x${r.before.h} | ${(r.before.bytes / 1024).toFixed(1)} | ${r.after.w}x${r.after.h} | ${(r.after.bytes / 1024).toFixed(1)} |`
  );
}
console.log(`\nFiles changed: ${rows.length}`);
console.log(`Changed-files subtotal: ${(changedTotalBefore / 1024 / 1024).toFixed(2)}MB -> ${(changedTotalAfter / 1024 / 1024).toFixed(2)}MB`);
console.log(`\nGRAND TOTAL templates/*/images/ (all 5 systems): ${(totalBefore / 1024 / 1024).toFixed(2)}MB -> ${(totalAfter / 1024 / 1024).toFixed(2)}MB`);
