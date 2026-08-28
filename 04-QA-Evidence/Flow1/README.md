# Flow 1 — Foundation: first-load + theming (QA evidence)

Mechanical oracle: `node bot/test/wave1-perf-theme.test.js`  
Build: `npm run build:app` (must produce light `builder/generated/templates-data.js` ≪ 64 KB).

## Real-browser checklist (QA / advocate)

Do **not** time this on localhost alone. Use DevTools throttling.

### A. First-load catalog (ITEM 9)

1. Start isolated server (example):
   ```bash
   npm run build:app
   PORT=8799 HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 DATA_DIR=/tmp/hidook-flow1 \
     node bot/web.js
   ```
2. Open Chromium/Brave → DevTools → Network → **Disable cache** → throttling **Fast 3G** or **10 Mbit**.
3. Navigate to `http://127.0.0.1:8799/app/` (hard reload).
4. **Pass:** template cards (thumbnails + Start/Preview) visible in **≤ 3 s** without manual refresh.
5. Network panel: `templates-data.js` is small (order of KB, not tens of MB). Heavy `generated/templates/<id>.js` loads only after Start/Preview/editor need — not as blocking boot scripts.
6. Warm reload with cache allowed: `templates-data.js` / thumbs return **304** (or revalidate + ETag). Response headers include `Cache-Control`, `ETag` or `Last-Modified`.

Save screenshots here:
- `01-first-load-throttled-t3s.png` — grid visible under throttle at ~3s
- `02-network-light-registry.png` — Network showing small `templates-data.js`

### B. Theme colors paint preview (ITEM 11)

1. Start any template → editor.
2. Open **Color** popover (top bar).
3. Set **Accent** to green `#16A34A` → preview buttons/accents turn green **inside the iframe**.
4. Set **Page background** to red `#FF0000` → page paper/background turns red in the iframe.
5. Repeat for **each** template: product-menu, local-service, portfolio, **professionals** (historically dead).
6. Open **Site details** → **Hero background**: change color and/or Choose photo → hero region updates (not a raw CSS-only box).
7. Optional: test-pay publish → live/isolated URL matches preview colors.

Save screenshots:
- `03-professionals-accent-green.png`
- `04-professionals-bg-red.png`
- `05-hero-background-control.png`

### C. Fail criteria (reject)

- Grid still blank for >3s on throttled first load.
- Boot still downloads multi-MB base64 JS.
- Color picker writes config but preview pixels unchanged (Opus dead-control trap).
- `theme.cream` / page background has no real control.
- No Cache-Control/ETag on `/app/generated/*`.

## Out of scope for Flow 1

RO labels, WhatsApp badge, Details auto-open, badge, legal, export, Stripe trial — later flows.
