# Cloudflare and customer-site hosting (Hidook Site Builder)

**Product:** **Hidook Site Builder**. The commercial product is the **browser builder** (account, editor, card/trial, publish, edit, renew). Customer live sites are conceptually `https://{slug}.sites.hidook.agency` after **payment before first public publish** — Stripe **subscription** with a **7-day card trial**; site **live immediately after a valid card**.

This note is for the engineering team. It is **not** a checklist to cut over live DNS or create production Cloudflare resources for `hidook.agency` in this slice. Those remain **owner-only launch gates** (`PRODUCT.md`).

Do **not** treat legacy names (`desserdina`, DESSERD), the root bakery `config.json` / `index.html` sample, or `wrangler.toml` `name = "desserdina"` as the product identity. Those are leftover sample / legacy labels — **not** operator product copy and **not** the commercial deploy path.

## What Cloudflare is for (product shape)

| Piece | Role |
|---|---|
| Browser builder + bot (`bot/`, Railway image) | Commercial surface; subscription trial (card required); publish pipeline after valid card |
| Customer site hosting | After card/trial, published sites may land on Cloudflare Pages (or another configured provider) under the agency subdomain model |
| Root sample static files | Example brochure data for the zero-dep renderer — **not** the Hidook product name |

Telegram only creates or opens the **same** unpaid draft in the browser builder. It is not a second Cloudflare deploy console.

## In scope for the team (local / test / isolated)

- Local bot + builder with **test** Stripe and **fake-or-isolated** deploy (`HIDOOK_FAKE_DEPLOY=1`, refused when `NODE_ENV=production`). Fake deploy is **not** the client journey.
- Reading how trial/paid publish chooses a deploy provider (`DEPLOY_PROVIDER=cloudflare` and related env — see `bot/DEPLOY.md`).
- Static render of a sample or registry site for inspection:

  ```bash
  node build.js
  # optional local preview of generated HTML
  node .claude/serve.js   # http://localhost:4173
  ```

Do **not** run live `wrangler pages deploy` against a production Hidook project, attach real custom domains, or change production DNS as “finishing this doc.”

## Out of scope here (owner-only)

Per `PRODUCT.md`, **do not implement** as team work in this slice:

- Production Cloudflare account wiring and live Pages project creation for Hidook (owner-only)
- Live DNS for `hidook.agency` / `sites.hidook.agency` (owner-only; not this slice)
- Custom-domain cutover for paying customers (concierge after card/trial; not required for the launch happy path; owner-only)
- Live Stripe Product/Prices, Customer Portal, and refunds (owner-only)

When the owner enables production Cloudflare, ops env and Railway notes live in `bot/DEPLOY.md` (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, optional `BRAND_DOMAIN`). That is configuration of the **bot’s trial/paid-publish path**, not a manual “deploy the bakery sample” workflow.

## What the sample static tree is (and is not)

`scripts/build-site.js` / `npm run build` can render `index.html` from `template.html` + `config.json` into `dist/` for local inspection. That pipeline is a **renderer demo / sample brochure**, not instructions to ship the repo root as “the product site” under a legacy Pages project name.

- Build inputs (`template.html`, `config.json`) and sample assets are **customer-site examples**.
- Do **not** teach `--project-name desserdina`, `desserdina.pages.dev`, or a custom domain like `desserdina.ro` as Hidook Site Builder identity.
- `wrangler.toml` may still carry a legacy `name`; ignore it as product branding.

## Related docs

- `PRODUCT.md` — product contract and owner-only launch gates
- `bot/DEPLOY.md` — Railway bot + builder 24/7, env vars including Cloudflare for trial/paid client sites
- `bot/README.md` — operator overview of bot + builder
- `LAUNCH.md` — team-oriented launch notes (local/test unless owner gates)
- `README.md` — repo map and commercial path
