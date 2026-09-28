'use strict';
/*
 * builder/history-store.js — persists the editor's undo/redo stack
 * (builder/app.js `historyState`) across a reload or an accidental tab
 * close+reopen within the SAME browser session (PLAN-UX-2026-09-27 §5.3,
 * "Undo/redo real dincolo de sesiunea curentă"). Before this file, Ctrl+Z
 * and the toolbar Undo button only ever knew about edits made since the page
 * was last loaded — resetHistory() always started a brand-new one-entry
 * baseline on every #edit load, so a reload (or a tab the browser restores
 * after an accidental close) silently threw away every undo step, with no
 * warning to the owner mid-edit.
 *
 * Storage: sessionStorage, not localStorage — deliberately scoped to "this
 * browser session", matching the task ("within the session"), and it clears
 * itself when the whole browser session actually ends instead of living
 * forever like a draft does. One JSON object under HISTORY_STORAGE_KEY,
 * keyed by the SAME scope key drafts use — 'site:<id>' / 'local:<draftId>'
 * (see SCOPES_KEY / currentScopeKey() in builder/app.js) — so each site/
 * not-yet-created design keeps its own independent stack, exactly like
 * drafts already do:
 *   { [scopeKey]: { ownerUserId, index, entries: [{json,size}], updatedAt } }
 *
 * Ownership: every record is stamped with `ownerUserId` using the exact same
 * contract as hb.draft.scopes.v1 (currentAccountKey()/draftOwnedByCurrentAccount()
 * in app.js) — an unowned record (nobody has signed in on it yet) is
 * adoptable by whoever signs in first; an owned one is readable ONLY by that
 * same account, and is only ever ASSIGNED, never erased, by a later save (a
 * session expiring mid-edit must not silently un-scope an owned record back
 * to "adoptable by anyone"). historyStoreClearOwned() is called from the
 * same place clearOwnedLocalDraftState() is (doLogout()/
 * confirmLogoutEverywhere() in builder/app.js), so a same-tab account switch
 * can never Ctrl+Z back into the previous account's edits either.
 *
 * Size discipline — sessionStorage is typically a 5-10MB-per-origin budget,
 * SHARED with every other sessionStorage write this app makes, and a config
 * can carry several base64 data: URI photos worth a few MB each:
 *   - capped to the last HISTORY_PERSIST_MAX_ENTRIES steps per scope (oldest
 *     dropped first — same "oldest evicted first" contract as the in-memory
 *     stack's own HISTORY_MAX_ENTRIES in app.js, and the same number, so a
 *     restored stack never needs re-trimming against the in-memory cap);
 *   - a combined HISTORY_PERSIST_MAX_BYTES_PER_SCOPE budget, oldest dropped
 *     first;
 *   - within a single step, any embedded base64 image data: URI over
 *     HISTORY_IMAGE_STRIP_THRESHOLD chars (a real photo — plain text/hex/
 *     short values never get anywhere near this big) is replaced with a
 *     short placeholder token before persisting. The in-memory
 *     `historyState` in app.js keeps the real pixels for same-session undo;
 *     only the PERSISTED copy loses them. Undoing past a reload into a step
 *     that had a photo stripped restores every other field correctly and
 *     leaves that one photo as a visible placeholder — a documented
 *     trade-off (re-uploading one photo is one click; losing an entire edit
 *     session to a reload is not), not silent data loss.
 *   - a sibling cap on the NUMBER of scopes kept (HISTORY_PERSIST_MAX_SCOPES),
 *     least-recently-updated evicted first, so trying many designs across a
 *     long session doesn't grow this store forever.
 *
 * Loaded before app.js (see builder/index.html) as a small set of plain
 * global functions — same convention as the rest of the builder (no module
 * system here). app.js calls these guarded with
 * `typeof historyStoreSave === 'function'`, the same pattern already used
 * for every other optional cross-file/cross-region helper in app.js
 * (mergeDraftConfigs, TAB_ID, pushHistory itself…) — so the isolated-
 * extraction test sandboxes that eval a single app.js function's source
 * without ever loading this file keep working unchanged.
 */

var HISTORY_STORAGE_KEY = 'hb.history.v1';
var HISTORY_PERSIST_MAX_ENTRIES = 40; // matches app.js's own HISTORY_MAX_ENTRIES
var HISTORY_PERSIST_MAX_BYTES_PER_SCOPE = 3 * 1024 * 1024; // 3MB per scope
var HISTORY_PERSIST_MAX_SCOPES = 20; // sibling cap to app.js's MAX_DRAFT_SCOPES (40) — history is heavier per entry
var HISTORY_IMAGE_STRIP_THRESHOLD = 20000; // chars — real photos are far bigger; text/hex fields never reach this
var HISTORY_IMAGE_PLACEHOLDER = '"__HB_HISTORY_IMAGE_OMITTED__"';
var HISTORY_IMAGE_RE = new RegExp(
  '"data:image\\/[a-zA-Z0-9+.\\-]+;base64,[A-Za-z0-9+/=]{' + HISTORY_IMAGE_STRIP_THRESHOLD + ',}"',
  'g'
);

/** Replace any embedded base64 image data: URI over the threshold with a
 * short placeholder — operates on the raw serialized JSON text (no
 * parse/re-stringify round trip needed), safe because the base64 alphabet
 * never contains an unescaped quote or backslash that would otherwise need
 * JSON-escaping in the replacement. */
function historyStoreStripImages(json) {
  if (typeof json !== 'string') return json;
  return json.replace(HISTORY_IMAGE_RE, HISTORY_IMAGE_PLACEHOLDER);
}

function historyStoreReadAllScopes() {
  try {
    var raw = sessionStorage.getItem(HISTORY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

function historyStoreWriteAllScopes(all) {
  try { sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(all)); return true; }
  catch (_) { return false; }
}

/** Evict least-recently-updated scopes once the store holds more than
 * HISTORY_PERSIST_MAX_SCOPES — never the scope just written. */
function historyStorePruneScopes(all, keepKey) {
  var keys = Object.keys(all);
  if (keys.length <= HISTORY_PERSIST_MAX_SCOPES) return;
  var candidates = keys.filter(function (k) { return k !== keepKey; });
  candidates.sort(function (a, b) { return (all[a].updatedAt || 0) - (all[b].updatedAt || 0); });
  var toRemove = keys.length - HISTORY_PERSIST_MAX_SCOPES;
  for (var i = 0; i < candidates.length && toRemove > 0; i++) {
    delete all[candidates[i]];
    toRemove--;
  }
}

/**
 * Persist the in-memory undo/redo stack for `scopeKey`. `ownerUserId` is
 * ASSIGNED (never used to erase an existing stamp — see the file header) so
 * a session expiring mid-edit can't un-scope an already-owned record back to
 * "adoptable by anyone". `stack` is app.js's `historyState.stack`
 * ({json,size}[]), `index` its current pointer. Best-effort: a full
 * sessionStorage quota fails silently, since the in-memory stack in app.js
 * is always the source of truth for THIS tab's own live session regardless
 * of whether persisting it succeeds.
 */
function historyStoreSave(scopeKey, ownerUserId, stack, index) {
  if (!scopeKey || !Array.isArray(stack) || !stack.length) return false;
  var entries = stack.map(function (e) {
    var json = historyStoreStripImages(e && e.json);
    return { json: json, size: (json && json.length) || 0 };
  });
  var idx = index;
  if (entries.length > HISTORY_PERSIST_MAX_ENTRIES) {
    var drop = entries.length - HISTORY_PERSIST_MAX_ENTRIES;
    entries = entries.slice(drop);
    idx = Math.max(0, idx - drop);
  }
  var total = entries.reduce(function (sum, e) { return sum + e.size; }, 0);
  while (entries.length > 1 && total > HISTORY_PERSIST_MAX_BYTES_PER_SCOPE) {
    total -= entries[0].size;
    entries.shift();
    idx = Math.max(0, idx - 1);
  }
  var all = historyStoreReadAllScopes();
  var priorOwner = (all[scopeKey] && all[scopeKey].ownerUserId) || null;
  var finalOwner = ownerUserId || priorOwner || null;
  all[scopeKey] = { ownerUserId: finalOwner, index: idx, entries: entries, updatedAt: Date.now() };
  historyStorePruneScopes(all, scopeKey);
  var ok = historyStoreWriteAllScopes(all);
  // Quota exceeded even after per-scope trimming (many scopes' worth of
  // history combined) — progressively drop THIS scope's oldest entries and
  // retry a few times rather than give up on the very first push after a
  // reload freed up nothing yet.
  var attempts = 0;
  while (!ok && entries.length > 1 && attempts < 6) {
    entries = entries.slice(1);
    idx = Math.max(0, idx - 1);
    all[scopeKey] = { ownerUserId: finalOwner, index: idx, entries: entries, updatedAt: Date.now() };
    ok = historyStoreWriteAllScopes(all);
    attempts++;
  }
  return ok;
}

/**
 * Read back the persisted stack for `scopeKey`. Returns null when nothing is
 * stored, or when the stored record is owned by a DIFFERENT account than
 * `ownerUserId` (same gate as draftOwnedByCurrentAccount() in app.js — an
 * unowned record is readable by anyone, an owned one only by the same
 * account) — this is what keeps a same-tab account switch from resurrecting
 * the PREVIOUS account's undo history even before doLogout()'s own clearing
 * runs (belt-and-braces: both the write-time clear and this read-time gate
 * have to be defeated for a leak to happen).
 */
function historyStoreLoad(scopeKey, ownerUserId) {
  if (!scopeKey) return null;
  var all = historyStoreReadAllScopes();
  var rec = all[scopeKey];
  if (!rec || !Array.isArray(rec.entries) || !rec.entries.length) return null;
  if (rec.ownerUserId && rec.ownerUserId !== (ownerUserId || null)) return null;
  return rec;
}

/** Drop the persisted stack for one scope — used when a scope's persisted
 * entries have gone stale (no longer match what was actually resumed into
 * the editor) so a fresh baseline can be written in its place. */
function historyStoreClearScope(scopeKey) {
  if (!scopeKey) return;
  try {
    var all = historyStoreReadAllScopes();
    if (scopeKey in all) { delete all[scopeKey]; historyStoreWriteAllScopes(all); }
  } catch (_) { /* ignore */ }
}

/** Delete every persisted history record owned by `ownerUserId` — call this
 * from wherever the account signs out (see builder/app.js doLogout()/
 * confirmLogoutEverywhere() → clearOwnedLocalDraftState(), the same place
 * that clears hb.draft.scopes.v1) so a same-tab account switch never lets
 * the next account Ctrl+Z back into the previous one's edits. */
function historyStoreClearOwned(ownerUserId) {
  if (!ownerUserId) return;
  try {
    var all = historyStoreReadAllScopes();
    var changed = false;
    Object.keys(all).forEach(function (k) {
      if (all[k] && all[k].ownerUserId === ownerUserId) { delete all[k]; changed = true; }
    });
    if (changed) historyStoreWriteAllScopes(all);
  } catch (_) { /* ignore */ }
}
