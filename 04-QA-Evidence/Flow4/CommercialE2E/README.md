# Flow 4 Commercial E2E — browser evidence

- Captured: 2026-08-28T12:30:26.382Z
- Builder base: http://127.0.0.1:56164
- Site id: 4b702fcc-d898-4ed1-af8a-f86b7b3ec71b
- Slug: f4ev-4cd4b6a6
- Distinctive business name: Flow4 Commercial a413
- Publish paymentUrl: http://127.0.0.1:56164/app/#test-checkout=cs_test_0622d2994d9d8102c81bb6d3
- test-checkout session: cs_test_0622d2994d9d8102c81bb6d3
- test-pay complete: status=200 ok=true
- Live URL: http://127.0.0.1:56164/live/f4ev-4cd4b6a6/
- Portal: status=200 url=http://127.0.0.1:56164/app/#test-billing-portal=bps_test_3ffc633034f5a93c2d274a55
- After cancel site.status: unpublished
- After cancel site.paid: true
- Live page contains distinctive name before cancel: true
- Locked page RO "nu mai este public": true
- Locked page "anulat": true
- Locked page lang=ro: true
- Landing "7 zile": true
- Landing 99: true
- Landing 29: true

## Screenshots
- 01-builder-landing-commercial.png — RO trial/card/99/29 chrome
- 02-unpaid-live-locked.png — unpaid /live Romanian lock
- 03-after-checkout-live.png — fake checkout → live immediately
- 04-after-cancel-locked-ro.png — cancel → Romanian unpublished state
- 05-builder-after-cancel.png — builder after cancel

## Gates
- HIDOOK_TEST_PAY=1, HIDOOK_ISOLATED_DEPLOY=1, no STRIPE_SECRET_KEY
- node bot/test/flow4-commercial-e2e.test.js
