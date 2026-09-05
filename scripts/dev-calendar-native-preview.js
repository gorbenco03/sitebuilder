'use strict';
/**
 * Local preview helper for native calendar owner dashboard + public widget.
 * Re-execs with --experimental-sqlite when needed (Node 22.5+ / 23).
 */
if (!process.execArgv.includes('--experimental-sqlite')) {
    const { spawn } = require('child_process');
    const child = spawn(
        process.execPath,
        ['--experimental-sqlite', ...process.execArgv, __filename, ...process.argv.slice(2)],
        { stdio: 'inherit', env: process.env }
    );
    child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        process.exit(code == null ? 1 : code);
    });
    return;
}

process.env.PORT = process.env.PORT || '8791';
process.env.SERVER_SECRET = process.env.SERVER_SECRET || 'cal-v2-owner-preview-secret';
process.env.HIDOOK_FAKE_DEPLOY = process.env.HIDOOK_FAKE_DEPLOY || '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
if (!process.env.DATA_DIR) {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-owner-'));
}
require('../bot/server.js').startServer({ port: Number(process.env.PORT) });
