'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../04-QA-Evidence/S70-professionals/professionals-cabinet-marin.html'));
const port = Number(process.env.PORT || 8769);
http.createServer((q, s) => {
  s.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  s.end(html);
}).listen(port, '127.0.0.1', () => console.log('up', port));
