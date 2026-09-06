# Wave5-photos: reconciling S54/S55 photo-quality floors with the PERF-02 image wave

## Context

Commit 8a13c19 (perf wave) recompressed template source photos to fix a real
audit finding (first load 8-12s -> target 3s; published transfer 1.63MB ->
724KB; LCP 6.9s -> 3.8s). It resized every non-hero gallery/detail photo in
product-menu, portfolio and local-service from 1280px (or 1280x858) down to
640px (or 640x429) and recompressed aggressively.

Two older oracles, `bot/test/s54-commercial-photos.test.js` and
`bot/test/s55-subject-photos.test.js`, encode a photo-quality floor for the
three original commercial seed systems (product-menu, portfolio,
local-service): every image referenced from presets.json, and every leftover
file in each `images/` directory, must be >=960x640px and >=24 KiB (S54) /
>=120 KiB (S55). The task description called out `cn-d1.jpg` as a known
failure, but a full audit found the perf wave had pushed **every** non-hero,
non-og-image gallery/detail photo below at least one of the two floors.

## Violations found (before fix)

85 files across the three seed systems failed S54 and/or S55 — all at
640x640 or 640x429, ranging 34.7KiB-138.8KiB (all below the 960x640 / 120KiB
floor). Full before-state audit: `before-full-audit.csv`. Breakdown:

- product-menu: 24 files (cn-d1..3, cn-ig1..6, cn-r1..3, tv-a1..3, tv-ig1..6, tv-m1..3)
- portfolio: 33 files (iv-ig1..6, iv-mani1..4, iv-par1..4, iv-team-c/d/l, sf-ext1..4, sf-ig1..6, sf-mua1..3, sf-team-a/m/o)
- local-service: 28 files (ct-ac1..3, ct-fat1..2, ct-ig1..6, ct-rep1..3, pr-baie1..3, pr-buc1..3, pr-ext1..2, pr-ig1..6)

Hero and og:image files (cn-hero, cn-og, tv-hero, tv-og, iv-hero, iv-og,
sf-hero, sf-og, ct-hero, ct-og, pr-hero, pr-og) were already >=960x640 and
comfortably over both byte floors — the perf wave left those alone (hero
images are explicitly allowed up to 1600px by audit-performance.test.js) —
so none of the 12 hero/og files needed touching.

## Fix

For each of the 85 violating files: recovered the pre-perf-wave original
(1280px long edge, or 1280x858 for the 4:3 crops) from git history at
`04e65f0` (the commit immediately before the perf wave started, `8f5c788` /
`8a13c19`) via `git archive`, confirmed every recovered original was already
>=960x640 (no upscaling needed — see `audit_originals.js`), then re-encoded
each with macOS `sips` at `-Z 960` (resize so the long edge is exactly 960px,
preserving aspect ratio -> 960x960 for square crops, 960x643/644 for the
4:3 crops) and a per-file binary-searched JPEG quality (`reencode.js`,
not committed here — scratch driver) that lands the smallest file size still
>=123.5KB, i.e. just above the S55 120KiB floor with a small safety margin.
Quality landed anywhere from 34 (already-detailed photos) to 95 (very flat,
highly compressible photos) depending on image content — a fixed quality
would have either bloated the detailed photos or left the flat ones under
the floor, so the per-file search was necessary to hit "smallest file that
still clears the quality floor" for every photo individually.

No file was upscaled: every recovered original already exceeded 960x640
before resampling. No threshold in any of the three owned test files was
changed — s54/s55 floors are untouched, and audit-performance.test.js's
6MB/16MB ceilings, 1700px bounding box, and PERF-01/04/06 checks were not
touched either; they simply had enough headroom to absorb the size increase.

## Size delta

- Changed-files subtotal: 6.08MB -> 10.19MB (85 files)
- templates/{product-menu,local-service,portfolio,professionals}/images
  (the 4 systems audit-performance.test.js budgets): 9.92MB -> 14.52MB,
  against a 16MB combined ceiling and 6MB per-template ceiling (both still
  pass with headroom — see `after-full-audit.csv` and the test run below).
- Grand total across all 5 template systems' images/ (incl. desserdirina,
  which this task does not own): 12.55MB -> 16.65MB.

## Test results (final)

```
node --experimental-sqlite --test bot/test/s54-commercial-photos.test.js bot/test/s55-subject-photos.test.js bot/test/audit-performance.test.js
```
All three files: all checks PASS. No assertion skipped, weakened, or deleted.

## Visual verification

Rendered product-menu (`casa-nord` preset) and portfolio (`atelier-ivoire`
preset) via `node scripts/build-gallery.js` (dist-gallery/, gitignored) and
loaded them in a real browser (a plain `python3 -m http.server` pointed at
this worktree — the repo's own `.claude/serve.js` preview config runs against
the main checkout, not this worktree, so it could not see these edits).
Confirmed via `img.naturalWidth`/`naturalHeight`/`complete` on every loaded
`<img>` that all re-encoded photos render at the expected 960x960 / 960x643
with no broken images. The Browser pane could not composite screenshots in
this session (background-agent environment, no live display), so instead of
full-page screenshots, `samples/` holds direct before/after crops of two
representative re-encoded photos (one product-menu dish, one portfolio salon
shot) pulled straight from disk — both look sharp and commercial-grade at
960x960, with no visible quality loss from the 640x640 chip they replaced.

## Files in this evidence folder

- `before-full-audit.csv` / `after-full-audit.csv` — full per-file dims/size audit across all 5 template systems
- `audit_images.js` / `audit_originals.js` / `build_report.js` — the scratch audit/report scripts used to produce the above (kept for reproducibility)
- `samples/` — before/after JPEGs for two representative re-encoded photos
- `REPORT.md` — this file

## Re-encoded file table

| file | before dims | before KiB | after dims | after KiB |
|---|---|---|---|---|
| local-service/ct-ac1.jpg | 640x640 | 109.6 | 960x960 | 120.7 |
| local-service/ct-ac2.jpg | 640x640 | 91.4 | 960x960 | 125.3 |
| local-service/ct-ac3.jpg | 640x640 | 111.6 | 960x960 | 121.7 |
| local-service/ct-fat1.jpg | 640x640 | 88.6 | 960x960 | 124.0 |
| local-service/ct-fat2.jpg | 640x640 | 106.2 | 960x960 | 122.9 |
| local-service/ct-ig1.jpg | 640x640 | 110.5 | 960x960 | 120.6 |
| local-service/ct-ig2.jpg | 640x640 | 128.9 | 960x960 | 122.5 |
| local-service/ct-ig3.jpg | 640x640 | 84.5 | 960x960 | 121.7 |
| local-service/ct-ig4.jpg | 640x640 | 43.7 | 960x960 | 121.0 |
| local-service/ct-ig5.jpg | 640x640 | 117.9 | 960x960 | 121.0 |
| local-service/ct-ig6.jpg | 640x640 | 119.1 | 960x960 | 123.3 |
| local-service/ct-rep1.jpg | 640x640 | 122.8 | 960x960 | 124.4 |
| local-service/ct-rep2.jpg | 640x640 | 87.6 | 960x960 | 121.2 |
| local-service/ct-rep3.jpg | 640x640 | 68.4 | 960x960 | 128.2 |
| local-service/pr-baie1.jpg | 640x640 | 55.2 | 960x960 | 125.5 |
| local-service/pr-baie2.jpg | 640x640 | 57.5 | 960x960 | 124.8 |
| local-service/pr-baie3.jpg | 640x640 | 47.4 | 960x960 | 121.5 |
| local-service/pr-buc1.jpg | 640x640 | 67.0 | 960x960 | 120.9 |
| local-service/pr-buc2.jpg | 640x640 | 64.6 | 960x960 | 123.1 |
| local-service/pr-buc3.jpg | 640x640 | 51.2 | 960x960 | 122.6 |
| local-service/pr-ext1.jpg | 640x640 | 121.1 | 960x960 | 122.2 |
| local-service/pr-ext2.jpg | 640x640 | 138.8 | 960x960 | 123.5 |
| local-service/pr-ig1.jpg | 640x640 | 74.4 | 960x960 | 121.3 |
| local-service/pr-ig2.jpg | 640x640 | 59.1 | 960x960 | 124.6 |
| local-service/pr-ig3.jpg | 640x640 | 34.7 | 960x960 | 124.0 |
| local-service/pr-ig4.jpg | 640x640 | 68.3 | 960x960 | 121.5 |
| local-service/pr-ig5.jpg | 640x640 | 74.7 | 960x960 | 121.4 |
| local-service/pr-ig6.jpg | 640x640 | 48.2 | 960x960 | 121.7 |
| portfolio/iv-ig1.jpg | 640x640 | 79.0 | 960x960 | 122.4 |
| portfolio/iv-ig2.jpg | 640x640 | 64.3 | 960x960 | 122.0 |
| portfolio/iv-ig3.jpg | 640x640 | 66.6 | 960x960 | 123.1 |
| portfolio/iv-ig4.jpg | 640x640 | 50.3 | 960x960 | 121.1 |
| portfolio/iv-ig5.jpg | 640x640 | 65.4 | 960x960 | 122.0 |
| portfolio/iv-ig6.jpg | 640x640 | 77.9 | 960x960 | 121.2 |
| portfolio/iv-mani1.jpg | 640x429 | 39.3 | 960x643 | 121.8 |
| portfolio/iv-mani2.jpg | 640x429 | 42.8 | 960x643 | 121.8 |
| portfolio/iv-mani3.jpg | 640x640 | 73.1 | 960x960 | 121.3 |
| portfolio/iv-mani4.jpg | 640x429 | 39.1 | 960x643 | 121.3 |
| portfolio/iv-par1.jpg | 640x640 | 70.8 | 960x960 | 123.5 |
| portfolio/iv-par2.jpg | 640x640 | 68.1 | 960x960 | 124.1 |
| portfolio/iv-par3.jpg | 640x640 | 60.2 | 960x960 | 123.7 |
| portfolio/iv-par4.jpg | 640x640 | 95.4 | 960x960 | 124.0 |
| portfolio/iv-team-c.jpg | 640x640 | 56.6 | 960x960 | 122.7 |
| portfolio/iv-team-d.jpg | 640x640 | 49.2 | 960x960 | 120.9 |
| portfolio/iv-team-l.jpg | 640x640 | 63.4 | 960x960 | 121.5 |
| portfolio/sf-ext1.jpg | 640x640 | 63.6 | 960x960 | 122.0 |
| portfolio/sf-ext2.jpg | 640x640 | 72.1 | 960x960 | 121.7 |
| portfolio/sf-ext3.jpg | 640x640 | 80.5 | 960x960 | 125.2 |
| portfolio/sf-ext4.jpg | 640x640 | 68.7 | 960x960 | 129.4 |
| portfolio/sf-ig1.jpg | 640x640 | 78.3 | 960x960 | 123.5 |
| portfolio/sf-ig2.jpg | 640x640 | 52.4 | 960x960 | 123.3 |
| portfolio/sf-ig3.jpg | 640x640 | 50.5 | 960x960 | 121.5 |
| portfolio/sf-ig4.jpg | 640x640 | 86.0 | 960x960 | 121.0 |
| portfolio/sf-ig5.jpg | 640x640 | 78.3 | 960x960 | 122.5 |
| portfolio/sf-ig6.jpg | 640x640 | 90.4 | 960x960 | 124.9 |
| portfolio/sf-mua1.jpg | 640x640 | 51.2 | 960x960 | 122.8 |
| portfolio/sf-mua2.jpg | 640x640 | 55.9 | 960x960 | 121.9 |
| portfolio/sf-mua3.jpg | 640x640 | 62.5 | 960x960 | 121.3 |
| portfolio/sf-team-a.jpg | 640x640 | 47.3 | 960x960 | 121.7 |
| portfolio/sf-team-m.jpg | 640x640 | 40.1 | 960x960 | 120.7 |
| portfolio/sf-team-o.jpg | 640x640 | 76.9 | 960x960 | 120.7 |
| product-menu/cn-d1.jpg | 640x640 | 104.0 | 960x960 | 122.6 |
| product-menu/cn-d2.jpg | 640x640 | 70.9 | 960x960 | 122.9 |
| product-menu/cn-d3.jpg | 640x640 | 52.5 | 960x960 | 120.7 |
| product-menu/cn-ig1.jpg | 640x640 | 72.2 | 960x960 | 129.8 |
| product-menu/cn-ig2.jpg | 640x640 | 68.7 | 960x960 | 124.1 |
| product-menu/cn-ig3.jpg | 640x640 | 53.2 | 960x960 | 122.2 |
| product-menu/cn-ig4.jpg | 640x640 | 82.2 | 960x960 | 122.7 |
| product-menu/cn-ig5.jpg | 640x640 | 63.8 | 960x960 | 120.9 |
| product-menu/cn-ig6.jpg | 640x640 | 64.7 | 960x960 | 120.8 |
| product-menu/cn-r1.jpg | 640x429 | 67.3 | 960x643 | 122.8 |
| product-menu/cn-r2.jpg | 640x640 | 75.4 | 960x960 | 121.8 |
| product-menu/cn-r3.jpg | 640x429 | 58.1 | 960x643 | 121.3 |
| product-menu/tv-a1.jpg | 640x640 | 137.3 | 960x960 | 125.1 |
| product-menu/tv-a2.jpg | 640x640 | 82.1 | 960x960 | 122.1 |
| product-menu/tv-a3.jpg | 640x640 | 82.4 | 960x960 | 124.4 |
| product-menu/tv-ig1.jpg | 640x429 | 65.1 | 960x643 | 123.4 |
| product-menu/tv-ig2.jpg | 640x429 | 54.0 | 960x643 | 123.0 |
| product-menu/tv-ig3.jpg | 640x429 | 59.7 | 960x643 | 120.9 |
| product-menu/tv-ig4.jpg | 640x640 | 69.8 | 960x960 | 123.2 |
| product-menu/tv-ig5.jpg | 640x640 | 75.7 | 960x960 | 120.9 |
| product-menu/tv-ig6.jpg | 640x640 | 85.4 | 960x960 | 126.2 |
| product-menu/tv-m1.jpg | 640x640 | 80.0 | 960x960 | 121.4 |
| product-menu/tv-m2.jpg | 640x640 | 70.5 | 960x960 | 125.6 |
| product-menu/tv-m3.jpg | 640x640 | 63.1 | 960x960 | 123.7 |

Files changed: 85
Changed-files subtotal: 6.08MB -> 10.19MB

GRAND TOTAL templates/*/images/ (all 5 systems): 12.55MB -> 16.65MB
