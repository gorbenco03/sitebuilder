'use strict';
process.env.HIDOOK_FAKE_DEPLOY = process.env.HIDOOK_FAKE_DEPLOY || '1';
const port = Number(process.env.PORT) || 54710;
const { startServer } = require('../bot/server.js');
startServer({ port });
console.log('flow2 local server ready on', port);
