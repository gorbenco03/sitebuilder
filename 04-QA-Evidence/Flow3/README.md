# Flow 3 browser evidence

- Builder base: http://127.0.0.1:61506
- Static export serve: http://127.0.0.1:61507
- Builder cookie banner visible initially: true
- Export cookie banner element: 1, shown: true
- Business name: Flow3 Evidence Brutărie
- Export files: 38
- ZIP path: 04-QA-Evidence/Flow3/flow3-evidence.zip
- Unzipped: 04-QA-Evidence/Flow3/unzipped-export/

QA should open:
1. http://127.0.0.1:61506/app/ — cookie banner + footer Terms/Privacy/Cookies
2. http://127.0.0.1:61506/app/privacy.html (and terms/cookies)
3. Unzip flow3-evidence.zip and `python3 -m http.server` in unzipped-export/
4. Confirm privacy/terms/cookies + banner + badge with no Hidook runtime
