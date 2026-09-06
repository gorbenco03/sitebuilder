# Handoff — Wave 5 builder chrome (undo/redo, tab conflict, account menu, auth error)

Owner: builder/** (app.js, edit-overlay.js, app.css, index.html) + bot/test/wave5-builder-*.test.js.
Everything below is either (a) a change I made entirely inside my own files, noted here for
visibility, or (b) something outside my ownership that I could not fix myself and need another
agent/owner to act on.

## 1. Pre-existing test now conflicts with audit finding #6 (needs an owner outside builder/**)

`bot/test/flow2-unhappy-ro-and-salon-details-photo.test.js` (not mine — not builder/**, not a
`wave5-builder-*` file I'm allowed to touch) contains this assertion against `wireAuthForm`'s
extracted source text:

```js
check('auth email network failure copy', () => {
  assert.ok(
    wireAuthForm.includes("errorDiv.textContent = 'Nu am putut trimite linkul. Încearcă din nou.'"),
    'auth email failure uses the fixed Romanian fallback'
  );
  assert.ok(!/errorDiv\.textContent\s*=\s*(?:err|e)\.message/.test(wireAuthForm), 'auth error cannot expose an exception message');
  ...
});
```

This is a **direct regression guard for the exact bug the current audit lists as medium finding
#6**: "Eroare de autentificare generică ascunde mesajul specific trimis de server"
(04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md, medium findings table, row 6). My task
explicitly required fixing that finding, so `builder/app.js`'s `wireAuthForm` catch block now
shows `err.message` (the server's specific Romanian reason — e.g. "Introdu o adresă de email
validă." or a rate-limit reason from `bot/ratelimit.js`) when present, falling back to the fixed
generic string only when there is no server-sent reason (a real network failure, no `.status`).

I cannot edit that test file (outside my ownership), so after this fix
`node --experimental-sqlite --test bot/test/*.test.js` shows exactly **one new failure** versus
the pre-Wave-5 baseline: this test's first `check()` (`'auth email failure uses the fixed Romanian
fallback'`). I verified this is the *only* new failure — see
`04-QA-Evidence/Wave5-builder/` and my final report for the full before/after failing-file diff.

**What needs to happen:** whoever owns `bot/test/flow2-unhappy-ro-and-salon-details-photo.test.js`
should update its `'auth email network failure copy'` check to match the corrected, intended
behavior (show the server's specific reason when one exists; keep the fixed fallback only for a
genuine network/exception failure with no `.status`) instead of re-asserting the old bug. A new
oracle already proves the corrected behavior end-to-end against a real server:
`bot/test/wave5-builder-auth-error.test.js`.

I did **not** touch that test file myself, and did not weaken my fix to keep its literal
source-text assertion passing — the assertion encodes exactly the defect the task asked me to
remove, so keeping it green would mean not fixing finding #6.

## 2. Nothing else needed from other owners

Everything else for this wave (undo/redo, the multi-tab conflict warning, the editor account menu,
and the auth-error fix's actual code) lives entirely inside `builder/app.js`, `builder/edit-overlay.js`,
`builder/app.css` and `builder/index.html` — no changes to `build.js`, `bot/server.js`, `bot/web.js`,
or `templates/**` were needed.

One incidental note for whoever next touches `builder/app.js`: `injectDataHb()` and the
`EDIT_OVERLAY_SCRIPT` string (both near the top-middle of the file) are dead code confirmed by an
earlier audit correction (`04-QA-Evidence/Audit-2026-09-06-2225ca7/CORECTII.md`, PS-01) — nothing
calls them. I left them alone (out of scope for this task and not worth a drive-by deletion in a
change this size), but a future cleanup pass could remove them safely.
