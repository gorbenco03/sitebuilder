# S111 evidence

- base: http://127.0.0.1:50953
- pass: true
- playwright: false

- OK **app-bare-redirect**: `{"id":"app-bare-redirect","ok":true,"status":302,"loc":"/app/"}`
- OK **app-head**: `{"id":"app-head","ok":true,"status":200,"ct":"text/html; charset=utf-8"}`
- OK **app-styled**: `{"id":"app-styled","ok":true,"htmlHasAbsCss":true,"cssStatus":200}`
- OK **live-no-ig**: `{"id":"live-no-ig","ok":true,"status":200,"live":"http://127.0.0.1:50953/live/qalive-s111-noig/","hasIframeIg":false,"hasEmbedIframe":false,"hasSection":false,"bytes":16657}`
- OK **live-with-ig**: `{"id":"live-with-ig","ok":true,"status":200,"live":"http://127.0.0.1:50953/live/qalive-s111-withig/","hasPartner":true,"hasIframe":true,"hasDirectIg":false,"bytes":17534}`
- OK **css-390-chrome**: `{"id":"css-390-chrome","ok":true,"navNowrap":true,"badgeNoBreakWord":true,"cardNoEllipsis":true,"urlNoAnywhere":true}`
- FAIL **playwright**: `{"id":"playwright","ok":false,"err":"Cannot find module 'playwright'\nRequire stack:\n- /Users/Work/.hermes/worktrees/s111-instafidget-policy/scripts/s111-browser-evidence.js"}`
