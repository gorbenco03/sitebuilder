# Flow 4.3 CalendarLP — verification log

Date: 2026-08-28
Worker: builder-grok
Card: t_ff21c670
Parent SHA (required base): 7c3c3e198fc4bafe7c67a24afcb3bb9fa6c9cf68
Branch: wt/sitebuilder-flow4-3-calendar-lp
Note: frozen HEAD recorded in kanban handoff (not re-stamped here to avoid amend churn).

## Commands (exit 0)

```
node bot/test/flow4-calendar-lp-oracle.test.js
node bot/test/flow4-stale-commercial-docs.test.js
node bot/test/wave6-trial-copy.test.js
node bot/test/pricing.test.js
node bot/test/builder-pay-ui.test.js
node bot/test/s70-professionals-appointments.test.js
node bot/test/flow4-commercial-e2e.test.js
node bot/test/wave9-cancel-unpublish.test.js
node bot/test/s62-app-test-pay-live.test.js
git diff --check 7c3c3e1..HEAD
```

## Notes

- Option C runbook: OWNER-CALENDAR-CAL-DIY.md
- Boundary: bot/calendar-boundary.js (publicMode local-request; calDiyEnabled forced false)
- LP brand: no invented tokens — LP-BRAND-TOKENS.md
- Landing prices: how/success spans filled from /api/config
