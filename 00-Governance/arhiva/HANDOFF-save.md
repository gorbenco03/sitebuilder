# HANDOFF — Wave 9 save-state audit

A note for whoever next touches `bot/server.js` — this wave was not allowed
to edit it (`builder/**` only). Nothing here blocked shipping; the fix below
is worked around entirely in `builder/app.js` as noted, but the workaround
has a real remaining gap that only a server change can close.

## Anonymous editing has no server-side backup at all

`POST /api/draft` (`bot/server.js#handleSaveDraft`) calls `requireAuth`
first thing and 401s otherwise. That is fine for the debounced autosave this
wave adds for **signed-in** users (`scheduleServerAutosave`/
`runServerAutosave` in `builder/app.js`, reusing this exact endpoint — the
same one `downloadDraftHtml`/`downloadDraftZip` already called before an
export) — a real save failure there (offline, 500, a revoked session) now
surfaces visibly and is retryable, per this wave's brief.

But most first-time visitors design a site anonymously, before ever signing
in — and for them there is no server anywhere to fail loudly OR retry
against. `localStorage` (`hb.draft.v1`) is the *only* copy of their work.
That is durable across reloads/crashes on the *same browser, same device,
same origin*, but it is gone for good the moment any of those change:
clearing site data, private/incognito, a different browser, a different
device, or (the one every marketing team eventually hits) a corporate
device-wipe policy. `builder/app.js` already surfaces the one failure mode
it *can* see for anonymous editing — `localStorage.setItem` throwing
`QuotaExceededError` on a photo-heavy draft — as the same retryable "error"
pill this wave adds, but that is the only backstop that exists.

**Not a regression from this wave** — this was already true before Wave 9;
it is just more visible now that the rest of the save-state promise
("saving/saved/failed, and it is retryable") is real for signed-in users
and this one is not.

**Suggested real fix, next time `bot/server.js` is open:** a lightweight,
unauthenticated draft-backup endpoint keyed by a random device/browser token
(set as an httpOnly-adjacent cookie or just carried in `localStorage`
alongside the draft itself) — `POST /api/anon-draft` storing
`{deviceToken, templateId, config}` with a short TTL and a size cap well
under the existing `PUBLISH_BODY_MAX`, and a matching `GET` to recover it.
That would let the *exact* same `scheduleServerAutosave` machinery this wave
built cover anonymous editing too (drop the `currentUser` gate, pass the
device token instead of a session), closing the one real gap left in "the
customer never loses their work" without asking anonymous visitors to sign
in just to be safe.
