# HANDOFF — templates/professionals (Wave5)

Written by the agent that owns `templates/professionals/{template.html,styles.css,script.js,schema.json,presets.json}`
for the round-3 audit remediation wave. Everything below needs a change **outside**
that ownership boundary (`build.js`, `builder/**`, `bot/**`), so it is documented
here instead of edited directly, per this wave's rules.

## 1. SEO — server-side canonical/og:url (prof-05, medium) — still open

`templates/professionals/template.html` already has the render-side plumbing:

```html
<!-- @if seo.canonical -->
<link rel="canonical" href="{{seo.canonical}}">
<meta property="og:url" content="{{seo.canonical}}">
<!-- @endif -->
```

`seo.canonical` is never populated by the web-builder publish path — `grep -n canonical build.js`
only turns it up as a token literal, no assignment. Confirmed still true on HEAD after this wave
(untouched, not in my file scope). Recommendation (from the original audit, still valid):
populate `cfg.seo.canonical` with the absolute published URL (`PUBLIC_URL + /live/<slug>/`) at
publish time, the same way the live-URL success message is already built, and apply it to all
five templates, not just this one.

## 2. SEO — JSON-LD LocalBusiness: what I did vs. what's still worth doing server-side

The audit's prof-06 finding: `bot/flow.js`'s `buildSeo()` (which builds `cfg.seo.jsonLd`) is wired
into the **Telegram** flow only (`bot/flow.js:543,639`), never into `build.js`/`webpublish.js`'s
web-builder publish path. That gap is real and still exists on HEAD.

**What this wave added (entirely inside `templates/professionals/`, no server changes):**
`script.js`'s new `initLocalBusinessJsonLd()` builds a real `schema.org` `LocalBusiness` JSON-LD
block **client-side**, at page-load, by reading values already present in the rendered DOM
(business name, phone/email/address via new `data-ld="..."` attributes on the contact section and
footer, opening hours from the already-existing `#pr-weekly` data carrier — now rendered
unconditionally whenever `appointment.weekly` exists, not only in the local-form booking branch —
and the hero photo URL parsed out of the hero background's computed style). It uses
`JSON.stringify()`, so escaping is always correct regardless of what characters appear in the
business name/address. It only runs when no `<script type="application/ld+json">` already exists,
so a Telegram-published site's real `buildSeo()` output is never touched or duplicated.

Verified end-to-end on a real published site (`04-QA-Evidence/Wave5-professionals/after-jsonld.json`):
name, description, url, telephone, email, address, image and 5 days of opening hours all came
through with real values, no placeholders.

**Why this isn't the complete fix, and what I'd still recommend server-side:** this JSON-LD is
injected by JavaScript after the page loads. Googlebot executes JS and will see it, but any crawler
or tool that only parses the static HTML (some SEO auditing tools, some non-Google search engines)
will not. The durable fix is still the one the original audit recommended: extract `buildSeo()` (or
an equivalent) into a module callable from `build.js`/`webpublish.js` as well as `bot/flow.js`, so
`cfg.seo.jsonLd` is populated server-side for every publish path, and every template's existing
`<!-- @if seo.jsonLd --><script type="application/ld+json">{{& seo.jsonLd}}</script><!-- @endif -->`
block (already present, already sanitized via `sanitizeJsonLd()`) picks it up with no template
changes needed at all. If/when that lands, this wave's client-side fallback becomes a no-op safety
net (it explicitly backs off whenever a server-provided block is already present) rather than dead
code to remove.

No schema changes are needed on your end for this — `business.name`, `contact.phone`,
`contact.email`, `contact.address`, `appointment.weekly` and `hero.background` already carry
everything the JSON-LD needs; a future `buildSeo()`-for-web-builder implementation can source the
same fields.

## 3. Geo coordinates — not implemented, flagged only

The task asked for JSON-LD `geo` "where available." `templates/professionals/schema.json` has no
lat/lng field at all, so there is nothing to surface today — this is an honest omission, not a bug.
If geo ever matters (map pins, "near me" search), it would need: (a) two new optional fields in
this schema (`business.geoLat`/`business.geoLng`, plain text/number), and (b) confirming how the
generic drawer/inline-edit system in `builder/app.js` would surface a bare numeric field with no
natural on-page display location — that UX decision is outside a template-only change and is why
I didn't add half-finished fields for it.

## 4. `prof-01` — empty "+ Adaugă" service card still needs a real fix in `builder/app.js`

`builder/app.js`'s `onListAdd()` (around line ~1130) still seeds new list items with `''` for every
`text`-typed field in `itemShape` (confirmed still true on HEAD — I only read this file, did not
edit it, per the `builder/**` restriction):

```js
} else if (typeof itemShape === 'object' && itemShape !== null) {
    newItem = {};
    Object.keys(itemShape).forEach(k => {
      if (itemShape[k] === 'photos') newItem[k] = [];
      else if (itemShape[k] === 'list' || k === 'items') newItem[k] = [''];
      else newItem[k] = '';                 // <- services.N.label ends up ''
    });
}
```

For `templates/professionals`, a freshly-added service card's title (`services.N.label`) is
therefore always an empty string, both in the editor and — if the owner publishes without
noticing — on the live site. I added a **template-only, cosmetic** mitigation in
`templates/professionals/styles.css` (`.pr-svc__title:empty::before` shows an italic
"Serviciu nou — adaugă un titlu" placeholder), which prevents the card from ever rendering as
literally blank, but it doesn't fix the underlying empty string being saved/published. The real
fix — seeding a real default string (e.g. `"Serviciu nou"`) per schema field instead of `''` — needs
to happen in `onListAdd()`, which is out of my scope this wave.

## 5. `prof-02` — DOM corruption on list-add: already fixed, re-verified only

`builder/edit-overlay.js`'s `setupListControls()` already does
`lastContainer.parentNode.insertBefore(addBtn, lastContainer.nextSibling)` (confirmed on HEAD,
read-only check, not edited). This is the correct fix for the "+ Adaugă button grafted inside the
new `<li>`" bug the audit found — I did not find a regression here. No action needed on your end
unless a future change to that file reintroduces it.

## 6. Cookie-banner-driven CLS — a structural note for whoever next touches `bot/site-legal.js`

Root cause found this wave: `bot/site-legal.js`'s `COOKIE_BANNER_CSS` keys `.pr-hero`/`.pr-hero__copy`
(and the equivalent classes for the other 4 templates) padding off an `html.hb-cookie-open` class
that `COOKIE_BANNER_JS` toggles at runtime. On the old `templates/professionals/template.html`, the
banner markup + `<link rel=stylesheet href=cookie-banner.css>` + `<script src=cookie-banner.js>`
were mounted right before `</body>` — by the time that script ran (for a first-time, not-yet-
consented visitor) and set the class, the hero had already gone through an initial layout pass
*without* the cookie clearance padding, so applying the class produced a real second layout with
different box dimensions — a genuine, measured layout shift (0.0187 desktop / 0.0071 mobile on this
template specifically; see `04-QA-Evidence/Wave5-professionals/cls-before-full.json`).

**Fixed for `professionals` only, entirely inside my template.html**, by moving the cookie-banner
mount to the very top of `<body>` (before the hero), so `cookie-banner.js` resolves
`hb-cookie-open` synchronously before the hero is ever laid out — one layout pass instead of two.
CLS measured at exactly 0 after (`cls-after-full.json`).

I did not touch `bot/site-legal.js` (out of scope), so **the other four templates still mount the
cookie banner at the end of body and likely still carry this same shift** — worth checking
`product-menu`/`local-service`/`portfolio`/`desserdirina`'s `template.html` for the same
before-`</body>` cookie-banner placement and applying the same top-of-body move, since the fix is
purely about DOM/script *order* within each template, not anything in `site-legal.js` itself. (A
trade-off worth knowing: moving the banner's stylesheet earlier makes it render-blocking sooner,
which measurably delayed this template's LCP in my isolated Playwright reproduction — under the
same throttling profile the earlier perf wave used, ~600ms → ~2.7s. My read is that the "~600ms"
number was itself an artifact — see the `.pr-hero__bg` LCP-detection discrepancy in
`04-QA-Evidence/Wave5-professionals/` scripts — and the corrected ~2.7s is close to the hero
image's real transfer time under that throttle regardless of banner position. But it's worth an
independent look before rolling this pattern out to the other four templates.)
