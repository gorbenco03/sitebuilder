const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const SYSTEMS = ['product-menu', 'portfolio', 'local-service'];

function imageDimensions(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { w, h, kind: 'png' };
  }
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return { w: -1, h: -1, kind: 'unknown' };
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
      return { w, h, kind: 'jpeg' };
    }
    i += 2 + seglen;
  }
  return { w: -1, h: -1, kind: 'jpeg-no-sof' };
}

let totalBytes = 0;
let rows = [];
const allDirs = fs.readdirSync(path.join(ROOT, 'templates'));
for (const id of allDirs) {
  const dir = path.join(ROOT, 'templates', id, 'images');
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter(n => /\.(jpe?g|png)$/i.test(n));
  for (const f of files) {
    const abs = path.join(dir, f);
    const st = fs.statSync(abs);
    const { w, h, kind } = imageDimensions(abs);
    totalBytes += st.size;
    const isSeed = SYSTEMS.includes(id);
    const failS54 = isSeed && (st.size < 24*1024 || w < 960 || h < 640);
    const failS55 = isSeed && (st.size < 120*1024 || w < 960 || h < 640);
    rows.push({ id, f, size: st.size, w, h, kind, isSeed, failS54, failS55 });
  }
}
rows.sort((a,b) => a.id.localeCompare(b.id) || a.f.localeCompare(b.f));
console.log('id,file,bytes,KiB,w,h,kind,isSeed,failS54,failS55');
for (const r of rows) {
  console.log(`${r.id},${r.f},${r.size},${(r.size/1024).toFixed(1)},${r.w},${r.h},${r.kind},${r.isSeed},${r.failS54},${r.failS55}`);
}
console.log('---');
console.log('TOTAL bytes under templates/*/images/:', totalBytes, (totalBytes/1024/1024).toFixed(2), 'MiB');
console.log('violations s54:', rows.filter(r=>r.failS54).length);
console.log('violations s55:', rows.filter(r=>r.failS55).length);
