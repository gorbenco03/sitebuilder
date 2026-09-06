const fs = require('fs');
const path = require('path');

function imageDimensions(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return { w: -1, h: -1 };
  }
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
    const seglen = buf.readUInt16BE(i + 2);
    if (seglen < 2) break;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    i += 2 + seglen;
  }
  return { w: -1, h: -1 };
}

const ROOT = '/private/tmp/claude-502/wave5-originals/templates';
const systems = fs.readdirSync(ROOT);
let rows = [];
for (const sys of systems) {
  const dir = path.join(ROOT, sys, 'images');
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(f => /\.jpe?g$/i.test(f));
  for (const f of files) {
    const abs = path.join(dir, f);
    const st = fs.statSync(abs);
    const { w, h } = imageDimensions(abs);
    rows.push({ sys, f, w, h, size: st.size, ok: w >= 960 && h >= 640 });
  }
}
rows.sort((a,b) => a.sys.localeCompare(b.sys) || a.f.localeCompare(b.f));
for (const r of rows) {
  console.log(`${r.sys}/${r.f}: ${r.w}x${r.h} ${(r.size/1024).toFixed(1)}KiB ok=${r.ok}`);
}
console.log('total:', rows.length, 'failing min:', rows.filter(r=>!r.ok).length);
