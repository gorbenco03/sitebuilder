# Deploy desserdina to Cloudflare Pages

The desserdina landing page is a plain static site (no framework). This builds it into
`dist/` and uploads that folder to Cloudflare Pages. **Nothing here touches the bot** —
that stays on Railway.

## What gets deployed
`scripts/build-site.js` renders `index.html` from `template.html` + `config.json`, then
copies into `dist/` only the live-site files: `index.html`, `styles.css`, `script.js`,
`collage.js`, `robots.txt`, `sitemap.xml`, the referenced `images/…`, and a `_headers`
file (long-cache assets + basic security headers). Build inputs (`template.html`,
`config.json`) are **not** shipped.

## One-time setup
1. Install Node 18+ (already have it).
2. A Cloudflare account (free). Log in the CLI once:
   ```bash
   npx wrangler login
   ```

## Build + deploy (CLI — recommended, no Git needed)
```bash
npm run build                                          # produces dist/
npx wrangler pages deploy dist --project-name desserdina
```
- The first run creates the Pages project `desserdina` and returns a
  `https://desserdina.pages.dev` URL.
- Re-run both commands any time you change content — see below.

`wrangler.toml` already sets `name = "desserdina"` and `pages_build_output_dir = "dist"`,
so `npx wrangler pages deploy` (without args) also works after `npm run build`.

## Editing content later
All content lives in `config.json` (text, menu, contacts, Instagram widget) and the
layout in `template.html`. After editing:
```bash
npm run build && npx wrangler pages deploy dist
```

## Custom domain
Cloudflare dashboard → **Workers & Pages → desserdina → Custom domains → Set up a
domain** (e.g. `desserdina.ro`). If the domain is registered at Cloudflare, DNS is
automatic; otherwise point a CNAME to `desserdina.pages.dev`.

## Alternative: Git integration (if you push this repo to GitHub later)
Cloudflare dashboard → **Create application → Pages → Connect to Git**, then:
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Root directory:** `/` (leave default)

Every push then auto-deploys.

## Notes
- `dist/` is git-ignored (a build artifact) and excluded from the Vercel/bot builds, so
  it won't interfere with the current Vercel deploy or the Railway bot image.
- The Instagram widget is a third-party embed (hearth); its own card/layout is configured
  in the hearth dashboard, not here.
