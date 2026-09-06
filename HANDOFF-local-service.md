# HANDOFF — templates/local-service (Meserii), Wave 5

Written by the agent that owns `templates/local-service/*` only. Everything
below needs a change to `builder/edit-overlay.js`, `builder/app.js`, or
`build.js` — files another agent owns per the dispatch rules for this wave.
Nothing in this document has been applied; it is a precise pointer for
whoever picks it up next.

## 1. `SAFE_LIST_PATHS` in `builder/edit-overlay.js` omits "certifications" and "trust"

**File**: `builder/edit-overlay.js`, line 47:

```js
var SAFE_LIST_PATHS = ['services', 'menu', 'pricing', 'packages', 'steps', 'reviews'];
```

`isSafeList()` (same file, ~line 258) also special-cases `categories`
(`rootPath === 'categories' || /\.categories$/.test(rootPath)`), so
`services` and `categories` already get the generic overlay's own "+"/"×"
list controls. `trust` (local-service's "De ce noi" section,
`itemShape: {icon, title, text}`) and `certifications` (local-service,
`itemShape: "text"`, a plain string array) are not in the list and never
will get the generic overlay's controls, no matter what the template does.

**Fix**: add `'trust'` and `'certifications'` to `SAFE_LIST_PATHS` (or widen
`isSafeList()`'s pattern matching to something more general — every
usage today is an exact vertical-specific field name, so a plain string list
works but doesn't scale to new templates without a matching PR each time).

**Why this wasn't blocking**: `templates/local-service/script.js` does NOT
depend on the generic overlay for these lists any more. It builds its own
`initEditableLists()` controls for all four lists (services, trust,
categories, certifications) that speak the exact same postMessage protocol
(`{hb:'list-add',listPath}` / `{hb:'list-remove',path}` / `{hb:'text',path,
value}`) that `builder/app.js`'s `onListAdd`/`onListRemove`/
`onInlineTextEdit` already handle **unconditionally** — those handlers carry
no whitelist of their own; the whitelist only gates whether
`edit-overlay.js`'s *own* buttons appear. So add/remove/edit already works
end to end for all four lists on this template today, independent of this
item. Fixing `SAFE_LIST_PATHS` is not required for local-service to work,
but doing it would let a future audit/lens see `certifications`/`trust`
via the generic mechanism the way it already sees `services`/`categories`
on other templates, and would remove the need for the cleanup shim below.

## 2. `findListItemContainer()` in `builder/edit-overlay.js` picks the wrong DOM node for a single-text-field item

**File**: `builder/edit-overlay.js`, `findListItemContainer()` (~line 686
in this tree).

This is the exact bug the round-2 audit wave already fixed for
product-menu/professionals/portfolio (commit `51f602571702b79da4334571a51b0f9bf95f342a`,
*"fix(editor): repair list item add across templates"* — not present on
this branch's history; check whether it landed on `main` and, if so, whether
this worktree simply branched before it merged). That commit is not on this
worktree's history (`git merge-base --is-ancestor 51f60257... HEAD` is
false here), so `edit-overlay.js` on this branch still has the pre-fix
version.

Concretely, for local-service's own markup, a service item renders as:

```html
<li class="service-card ls-punch__row">
  <span class="ls-punch__n" aria-hidden="true"></span>
  <span class="ls-punch__label"><span data-hb-edit="services.0.label" data-hb-kind="text">Structuri și compartimentări</span></span>
</li>
```

`findListItemContainer()`'s first pass returns the LOWEST ancestor
containing every one of the item's `data-hb-edit` fields. Since a service
has only one field (`label`), that lowest ancestor is
`<span class="ls-punch__label">` — one level short of the real repeated
item root, `<li class="service-card">`. The round-2 fix (a second pass that
keeps climbing while the ancestor still belongs exclusively to this item,
i.e. contains no sibling index of the same list root) is exactly the fix
needed here too; it's already written and tested (that commit also adds
`bot/test/audit-editor-list-add.test.js`), it just needs to be present on
this branch.

**Why this wasn't blocking**: because of item 1, this template does not
rely on `edit-overlay.js`'s container detection for "services" at all (or
for anything else). `templates/local-service/script.js`'s
`initEditableLists()` finds each item's container via a CSS class it owns
precisely (`.service-card`, `.ls-trust__card`, `.ls-work`, `.ls-cert`), so
this bug never manifests for local-service. It **does still affect
local-service in one way**: because `services`/`categories` are
safe-listed, `edit-overlay.js`'s own `setupListControls()` still runs and
still injects its own (misplaced, for "services") +/- buttons alongside
this template's correct ones. `script.js` works around this with a
same-tick `setTimeout` cleanup that removes any `.hb-add-btn`/
`.hb-remove-btn` element edit-overlay.js adds, right after its `mount()`
has run (see the comment above `initEditableLists()`). **Once both items 1
and 2 above are fixed**, that cleanup shim becomes unnecessary — it will
just remove correctly-placed generic-overlay buttons that duplicate this
template's own, which is still correct behaviour, but at that point it
would be cleaner for local-service to drop its own controls for
"services"/"categories" and rely on the (now-fixed) generic overlay,
keeping only its own controls for "trust"/"certifications". That
simplification is optional follow-up, not required.

## 3. `onListAdd()` in `builder/app.js` always seeds every new item field with an empty string

**File**: `builder/app.js`, `onListAdd()` (~line 1105).

```js
} else if (typeof itemShape === 'object' && itemShape !== null) {
  newItem = {};
  Object.keys(itemShape).forEach(k => {
    if (itemShape[k] === 'photos') newItem[k] = [];
    else if (itemShape[k] === 'list' || k === 'items') newItem[k] = [''];
    else newItem[k] = '';
  });
}
```

Every text field on a freshly-added item starts empty, which (before any
fix) renders as an invisible/hard-to-notice empty `contenteditable` node —
exactly the bug this wave's task description calls out ("an item created
with all fields empty renders no editable node at all... that exact bug bit
the Salon template"). The round-2 fix wave's `edit-overlay.js` change
(`fillEmptyListItemDefaults`, same commit as item 2) patches this from the
overlay side, post-render, for whichever lists it manages.

**Why this wasn't blocking**: `templates/local-service/script.js`
implements its own equivalent (`fillEmptyDefaults()`, called from
`setupCustomList()` inside `initEditableLists()`) for all four of its
lists, seeding real Romanian placeholder text ("Serviciu nou", "Categorie
de lucrări nouă", "Certificare nouă", "Motiv nou" for trust) and echoing it
back via the existing `{hb:'text'}` protocol so it persists into
`draft.config` and survives publish/export. Verified end to end (add →
visible non-empty Romanian text → publish → live site) in
`bot/test/wave5-local-service-list-add-remove.test.js`.

**If `onListAdd()` is ever changed to seed real text itself** (e.g. by
reading a `default` value from `itemShape`, the way `schema.json` for other
verticals might want to declare it), local-service's own
`fillEmptyDefaults()` becomes redundant but harmless — it only acts on
fields it finds still empty after render, so it would simply become a
no-op once `onListAdd()` stops producing empty fields.

## Suggested order

Items 1 and 2 are independent of each other and of item 3. None of them
require touching `templates/local-service/*` again once done — the
whitelist/container-detection fix would only let local-service *simplify*
(drop its own controls for services/categories, or drop the cleanup
setTimeout), not something it depends on to function today.
