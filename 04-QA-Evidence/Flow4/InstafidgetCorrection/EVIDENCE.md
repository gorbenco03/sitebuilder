# Instafidget correction — 12mo free + same-browser new tab

Date: 2026-08-28
Worker: builder-grok
Card: t_9b9d1666
Required base: `540ad0572afb47f279bb6b6d7da0a78c2a9f5a8f`
Branch: `wt/sitebuilder-instafidget-tab-correction`

## Product truth (owner correction)

- Site Builder includes Instafidget **free for 12 months**; after that Instafidget Free with watermark unless upgraded in Instafidget.
- Not a separately paid Site Builder add-on.
- Stripe commercial model unchanged: 7-day card trial → 99 EUR/GBP/USD → renewal 29/year.
- Instafidget editor opens as a **normal new tab** in the same browser (`_blank` + `noopener`), not a named/sized popup window.

## Code changes

| File | Change |
|------|--------|
| `builder/app.js` | `connectInstagram`: `window.open(editorUrl, '_blank', 'noopener')` — removed named target `instagram-feed-editor` and `width=920,height=720` popup features |
| `LAUNCH.md` | Replaced "Instafidget is another team" with 12 months free → Free watermark truth |
| `bot/test/instafidget-tab-correction.test.js` | Focused oracle: causal RED on base popup + LAUNCH stale phrase; HEAD tab launch + copy + no paid-separately + Stripe model intact |
| `builder/index.html` | Already correct on base (`#ig-partner-note`: free 12 months, Free watermark) — no change |

## Verification commands (exit 0 unless noted)

```
node bot/test/instafidget-tab-correction.test.js   → exit 0
node bot/test/wave12-instafidget-note.test.js       → exit 0
node bot/test/social-feed-partner.test.js           → exit 0
node bot/test/s111-instafidget-policy.test.js       → exit 0
node bot/test/flow4-stale-commercial-docs.test.js   → exit 0
node bot/test/s67-s66-qa-fail.test.js               → exit 1 (pre-existing on 540ad05: catalog Trades "renovation" assertion — unrelated to Instafidget)
git diff --check 540ad05..HEAD                      → clean
```

## Browser/product note

Static/source oracle (no live Instafidget partner secret / no browser automation required for this card):

- Editor launch path is source-proven: no named window, no dimension features, `_blank` + `noopener`.
- Visible partner note already states included free 12 months then Instafidget Free (watermark).
- Product-visible docs scanned for "paid separately" / "separate paid add-on" / "Instafidget is another team" — none remain outside historical `00-Governance/` (exempt).

## Out of scope (honored)

No Stripe model change, no live Instafidget secrets, no Instafidget billing, no push/deploy.
