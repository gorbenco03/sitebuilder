'use strict';
/**
 * bot/zip.js — zero-dependency ZIP (store + deflate) writer.
 * Node built-ins only (zlib). Suitable for static site export archives.
 */

const zlib = require('zlib');
const crcTable = (function buildCrcTable() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
    const date = d instanceof Date ? d : new Date();
    const dosTime =
        (date.getHours() << 11) |
        (date.getMinutes() << 5) |
        Math.floor(date.getSeconds() / 2);
    const dosDate =
        ((date.getFullYear() - 1980) << 9) |
        ((date.getMonth() + 1) << 5) |
        date.getDate();
    return { dosTime, dosDate };
}

/**
 * @param {Array<{ name: string, data: Buffer|string }>} entries
 * @param {{ compress?: boolean }} [opts]  compress defaults true (deflate)
 * @returns {Buffer}
 */
function createZip(entries, opts) {
    const compress = !(opts && opts.compress === false);
    const now = new Date();
    const { dosTime, dosDate } = dosDateTime(now);

    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries || []) {
        if (!entry || !entry.name) continue;
        const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!name || name.includes('..')) continue;
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data == null ? '' : String(entry.data), 'utf8');
        const crc = crc32(data);
        let method = 0;
        let payload = data;
        if (compress && data.length > 64) {
            try {
                const deflated = zlib.deflateRawSync(data, { level: 6 });
                if (deflated.length < data.length) {
                    payload = deflated;
                    method = 8;
                }
            } catch (_) {
                payload = data;
                method = 0;
            }
        }
        const nameBuf = Buffer.from(name, 'utf8');
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4); // version needed
        local.writeUInt16LE(0x0800, 6); // UTF-8 flag
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28); // extra

        const localHeaderOffset = offset;
        localParts.push(local, nameBuf, payload);
        offset += local.length + nameBuf.length + payload.length;

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(localHeaderOffset, 42);
        centralParts.push(central, nameBuf);
    }

    const centralDir = Buffer.concat(centralParts);
    const centralOffset = offset;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    const count = (entries || []).filter((e) => e && e.name).length;
    // recount actual central entries
    const realCount = Math.floor(centralDir.length > 0 ? centralParts.filter((_, i) => i % 2 === 0).length : 0);
    const n = realCount || count;
    end.writeUInt16LE(n, 8);
    end.writeUInt16LE(n, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDir, end]);
}

module.exports = { createZip, crc32 };
