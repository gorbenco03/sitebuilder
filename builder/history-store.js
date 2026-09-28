'use strict';
/*
 * builder/history-store.js — persists the editor's undo/redo stack
 * (builder/app.js `historyState`) beyond the current browser session
 * (T-2, PLAN-UX-2026-09-27 §5.3 remainder: "Undo/redo real dincolo de
 * sesiunea curentă"). S-3 already made Ctrl+Z survive a reload or an
 * accidental tab close+reopen WITHIN the same browser session, backed by
 * sessionStorage. This file closes the remaining gap: a FULLY closed and
 * reopened browser. Backing store is now IndexedDB, with localStorage used
 * only as a fallback when IndexedDB itself is unavailable (disabled
 * storage, an old WebView, some private-browsing modes).
 *
 * API is PROMISE-based — IndexedDB is inherently async, so every exported
 * function here (historyStoreSave/Load/ClearScope/ClearOwned) returns a
 * Promise and NEVER rejects: every failure path (IndexedDB missing, quota
 * exceeded, localStorage disabled too) resolves a safe default
 * (false/null/undefined) instead. builder/app.js awaits the call where the
 * result decides what happens next (resetHistory()'s resume-vs-fresh-
 * baseline choice, clearOwnedLocalDraftState()'s "must be gone before the
 * next account can load" guarantee) and fire-and-forgets it everywhere else
 * (persistHistorySnapshot() — best-effort; the in-memory stack stays the
 * source of truth for the live tab regardless of whether the write lands).
 * historyStoreStripImages() alone stays a plain synchronous function — it
 * only touches a string, never storage.
 *
 * Scope/ownership contract — unchanged from S-3:
 *   - one record per scope key, the SAME 'site:<id>' / 'local:<draftId>' key
 *     drafts use (currentScopeKey() in app.js);
 *   - each record is stamped with `ownerUserId` using the exact same
 *     ASSIGN-never-ERASE contract as hb.draft.scopes.v1
 *     (currentAccountKey()/draftOwnedByCurrentAccount() in app.js): an
 *     unowned record is adoptable by whoever signs in first, an owned one is
 *     readable ONLY by that same account, and a session expiring mid-edit
 *     must never silently un-scope an owned record back to "adoptable by
 *     anyone";
 *   - historyStoreClearOwned() is called from the same place
 *     clearOwnedLocalDraftState() is (doLogout()/confirmLogoutEverywhere()/
 *     confirmDeleteAccount() in app.js) so a same-tab account switch, a
 *     logout-everywhere, or an account deletion can never leave a trace an
 *     undo could walk back into; historyStoreClearScope() is called when a
 *     SITE is deleted (retireLocalDraftForDeletedSite()) so a deleted site's
 *     undo history does not linger either.
 *
 * New in this revision:
 *   - IndexedDB (survives a fully closed browser) as the primary backend,
 *     localStorage (also durable, but only used when IndexedDB itself is
 *     unavailable) as the fallback — see historyStoreOpenDb();
 *   - a HISTORY_TTL_MS (7 days) per-record expiry, checked on every read and
 *     swept opportunistically on write, so a stack from a customer who never
 *     came back does not linger forever;
 *   - the same per-scope entry-count/byte cap and per-store scope-count cap
 *     S-3 had (HISTORY_PERSIST_MAX_ENTRIES / _BYTES_PER_SCOPE / _SCOPES), and
 *     the same large-embedded-photo stripping (HISTORY_IMAGE_STRIP_THRESHOLD)
 *     — all ported unchanged, just applied inside the new backend(s).
 *
 * Loaded before app.js (see builder/index.html) as a small set of plain
 * global functions — same convention as the rest of the builder (no module
 * system here). app.js calls these guarded with
 * `typeof historyStoreSave === 'function'`, same as every other optional
 * cross-file helper (mergeDraftConfigs, TAB_ID, pushHistory itself…) so the
 * isolated-extraction test sandboxes that eval a single app.js function's
 * source without ever loading this file keep working unchanged.
 */

var HISTORY_DB_NAME = 'hb_history_db';
var HISTORY_DB_VERSION = 1;
var HISTORY_DB_STORE = 'scopes';
// localStorage fallback ONLY (IndexedDB unavailable) — a different key than
// S-3's sessionStorage 'hb.history.v1': different backend, different schema
// (adds updatedAt-based TTL), not a migration of that data.
var HISTORY_LS_FALLBACK_KEY = 'hb.history.v2';

var HISTORY_PERSIST_MAX_ENTRIES = 40; // matches app.js's own HISTORY_MAX_ENTRIES
var HISTORY_PERSIST_MAX_BYTES_PER_SCOPE = 3 * 1024 * 1024; // 3MB per scope
var HISTORY_PERSIST_MAX_SCOPES = 20; // sibling cap to app.js's MAX_DRAFT_SCOPES (40) — history is heavier per entry
var HISTORY_IMAGE_STRIP_THRESHOLD = 20000; // chars — real photos are far bigger; text/hex fields never reach this
var HISTORY_IMAGE_PLACEHOLDER = '"__HB_HISTORY_IMAGE_OMITTED__"';
var HISTORY_IMAGE_RE = new RegExp(
  '"data:image\\/[a-zA-Z0-9+.\\-]+;base64,[A-Za-z0-9+/=]{' + HISTORY_IMAGE_STRIP_THRESHOLD + ',}"',
  'g'
);
var HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — an entry older than this is treated as gone

/** Replace any embedded base64 image data: URI over the threshold with a
 * short placeholder — operates on the raw serialized JSON text (no
 * parse/re-stringify round trip needed), safe because the base64 alphabet
 * never contains an unescaped quote or backslash that would otherwise need
 * JSON-escaping in the replacement. Pure/sync — never touches storage. */
function historyStoreStripImages(json) {
  if (typeof json !== 'string') return json;
  return json.replace(HISTORY_IMAGE_RE, HISTORY_IMAGE_PLACEHOLDER);
}

/** True when `rec` is missing/malformed or its `updatedAt` is older than the
 * 7-day TTL — an expired record must be treated exactly as "not there". */
function historyStoreIsExpired(rec, now) {
  var n = typeof now === 'number' ? now : Date.now();
  return !rec || typeof rec.updatedAt !== 'number' || (n - rec.updatedAt) > HISTORY_TTL_MS;
}

/** Trim `stack` to the shared per-scope caps (entry count, then combined
 * byte size) and stamp ownership using the ASSIGN-never-ERASE rule — shared
 * by both backends so IndexedDB and the localStorage fallback apply
 * identical limits. */
function historyStoreBuildRecord(scopeKey, ownerUserId, stack, index, priorOwner) {
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
  var finalOwner = ownerUserId || priorOwner || null;
  return { scopeKey: scopeKey, ownerUserId: finalOwner, index: idx, entries: entries, updatedAt: Date.now() };
}

/** A loaded record is usable only when it has entries, is not TTL-expired,
 * and (when owned) is owned by the SAME account asking — same gate S-3 used,
 * now also checking expiry. */
function historyStoreValidateLoaded(rec, ownerUserId) {
  if (!rec || !Array.isArray(rec.entries) || !rec.entries.length) return null;
  if (historyStoreIsExpired(rec)) return null;
  if (rec.ownerUserId && rec.ownerUserId !== (ownerUserId || null)) return null;
  return rec;
}

// ---------------------------------------------------------------------------
// IndexedDB backend (primary)
// ---------------------------------------------------------------------------

var _historyDbPromise = null;

/** Opens (and memoizes) the IndexedDB database. Resolves the DB handle, or
 * `null` when IndexedDB is unavailable or fails to open for any reason —
 * never rejects, never throws. Callers treat a null resolution as "fall
 * back to localStorage". */
function historyStoreOpenDb() {
  if (_historyDbPromise) return _historyDbPromise;
  _historyDbPromise = new Promise(function (resolve) {
    if (typeof indexedDB === 'undefined' || indexedDB === null) { resolve(null); return; }
    try {
      var req = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
      req.onupgradeneeded = function (ev) {
        try {
          var db = ev.target.result;
          if (!db.objectStoreNames.contains(HISTORY_DB_STORE)) {
            var store = db.createObjectStore(HISTORY_DB_STORE, { keyPath: 'scopeKey' });
            store.createIndex('by_owner', 'ownerUserId', { unique: false });
            store.createIndex('by_updatedAt', 'updatedAt', { unique: false });
          }
        } catch (_) { /* onsuccess/onerror below settle the promise either way */ }
      };
      req.onsuccess = function (ev) {
        var db = ev.target.result;
        try { db.onversionchange = function () { try { db.close(); } catch (_) { /* ignore */ } }; }
        catch (_) { /* ignore */ }
        resolve(db);
      };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    } catch (_) { resolve(null); }
  });
  return _historyDbPromise;
}

function historyStoreIdbGet(scopeKey) {
  return historyStoreOpenDb().then(function (db) {
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(HISTORY_DB_STORE, 'readonly');
        var req = tx.objectStore(HISTORY_DB_STORE).get(scopeKey);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }).catch(function () { return null; });
}

function historyStoreIdbGetAll(db) {
  return new Promise(function (resolve) {
    try {
      var tx = db.transaction(HISTORY_DB_STORE, 'readonly');
      var req = tx.objectStore(HISTORY_DB_STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { resolve([]); };
    } catch (_) { resolve([]); }
  });
}

function historyStoreIdbPut(rec) {
  return historyStoreOpenDb().then(function (db) {
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(HISTORY_DB_STORE, 'readwrite');
        tx.objectStore(HISTORY_DB_STORE).put(rec);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      } catch (_) { resolve(false); }
    });
  }).catch(function () { return false; });
}

function historyStoreIdbDeleteMany(keys) {
  if (!keys || !keys.length) return Promise.resolve(true);
  return historyStoreOpenDb().then(function (db) {
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(HISTORY_DB_STORE, 'readwrite');
        var store = tx.objectStore(HISTORY_DB_STORE);
        for (var i = 0; i < keys.length; i++) store.delete(keys[i]);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
        tx.onabort = function () { resolve(false); };
      } catch (_) { resolve(false); }
    });
  }).catch(function () { return false; });
}

/** Background maintenance sweep after a successful write: drops TTL-expired
 * scopes, then (if still over HISTORY_PERSIST_MAX_SCOPES) evicts the
 * least-recently-updated scopes, never the one just written. Fire-and-forget
 * from historyStoreSave() — never surfaces an error, never blocks the save
 * the caller is awaiting. */
function historyStorePruneIdb(keepKey) {
  return historyStoreOpenDb().then(function (db) {
    if (!db) return;
    return historyStoreIdbGetAll(db).then(function (all) {
      var now = Date.now();
      var toDelete = [];
      var alive = [];
      for (var i = 0; i < all.length; i++) {
        var rec = all[i];
        if (historyStoreIsExpired(rec, now)) toDelete.push(rec.scopeKey);
        else alive.push(rec);
      }
      if (alive.length > HISTORY_PERSIST_MAX_SCOPES) {
        var candidates = alive.filter(function (r) { return r.scopeKey !== keepKey; });
        candidates.sort(function (a, b) { return (a.updatedAt || 0) - (b.updatedAt || 0); });
        var over = alive.length - HISTORY_PERSIST_MAX_SCOPES;
        for (var j = 0; j < candidates.length && over > 0; j++) { toDelete.push(candidates[j].scopeKey); over--; }
      }
      if (toDelete.length) return historyStoreIdbDeleteMany(toDelete);
    });
  }).catch(function () { /* best-effort maintenance — never surfaces an error */ });
}

// ---------------------------------------------------------------------------
// localStorage backend (fallback — only used when IndexedDB is unavailable)
// ---------------------------------------------------------------------------

function historyStoreLsReadAll() {
  try {
    var raw = localStorage.getItem(HISTORY_LS_FALLBACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) { return {}; }
}

function historyStoreLsWriteAll(all) {
  try { localStorage.setItem(HISTORY_LS_FALLBACK_KEY, JSON.stringify(all)); return true; }
  catch (_) { return false; }
}

function historyStoreLsPruneScopes(all, keepKey) {
  var keys = Object.keys(all);
  if (keys.length <= HISTORY_PERSIST_MAX_SCOPES) return;
  var candidates = keys.filter(function (k) { return k !== keepKey; });
  candidates.sort(function (a, b) { return (all[a].updatedAt || 0) - (all[b].updatedAt || 0); });
  var toRemove = keys.length - HISTORY_PERSIST_MAX_SCOPES;
  for (var i = 0; i < candidates.length && toRemove > 0; i++) { delete all[candidates[i]]; toRemove--; }
}

function historyStoreSaveLs(scopeKey, ownerUserId, stack, index) {
  try {
    var all = historyStoreLsReadAll();
    var now = Date.now();
    Object.keys(all).forEach(function (k) { if (historyStoreIsExpired(all[k], now)) delete all[k]; });
    var priorOwner = (all[scopeKey] && all[scopeKey].ownerUserId) || null;
    var rec = historyStoreBuildRecord(scopeKey, ownerUserId, stack, index, priorOwner);
    all[scopeKey] = rec;
    historyStoreLsPruneScopes(all, scopeKey);
    var ok = historyStoreLsWriteAll(all);
    // Quota exceeded even after trimming — progressively drop this scope's
    // oldest entries and retry, same as S-3's own retry loop.
    var attempts = 0;
    while (!ok && rec.entries.length > 1 && attempts < 6) {
      rec.entries = rec.entries.slice(1);
      rec.index = Math.max(0, rec.index - 1);
      all[scopeKey] = rec;
      ok = historyStoreLsWriteAll(all);
      attempts++;
    }
    return Promise.resolve(ok);
  } catch (_) { return Promise.resolve(false); }
}

function historyStoreLoadLs(scopeKey, ownerUserId) {
  try {
    var all = historyStoreLsReadAll();
    return Promise.resolve(historyStoreValidateLoaded(all[scopeKey], ownerUserId));
  } catch (_) { return Promise.resolve(null); }
}

function historyStoreClearScopeLs(scopeKey) {
  try {
    var all = historyStoreLsReadAll();
    if (scopeKey in all) { delete all[scopeKey]; historyStoreLsWriteAll(all); }
  } catch (_) { /* ignore */ }
  return Promise.resolve();
}

function historyStoreClearOwnedLs(ownerUserId) {
  try {
    var all = historyStoreLsReadAll();
    var changed = false;
    Object.keys(all).forEach(function (k) {
      if (all[k] && all[k].ownerUserId === ownerUserId) { delete all[k]; changed = true; }
    });
    if (changed) historyStoreLsWriteAll(all);
  } catch (_) { /* ignore */ }
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Public API — IndexedDB when available, localStorage fallback otherwise.
// Every function returns a Promise and never rejects.
// ---------------------------------------------------------------------------

/**
 * Persist the in-memory undo/redo stack for `scopeKey`. Resolves `true` on
 * success, `false` on any failure (both backends unavailable/full) — always
 * best-effort: the in-memory stack in app.js stays the source of truth for
 * THIS tab's own live session regardless of whether persisting it succeeds.
 */
function historyStoreSave(scopeKey, ownerUserId, stack, index) {
  if (!scopeKey || !Array.isArray(stack) || !stack.length) return Promise.resolve(false);
  return historyStoreOpenDb().then(function (db) {
    if (!db) return historyStoreSaveLs(scopeKey, ownerUserId, stack, index);
    return historyStoreIdbGet(scopeKey).then(function (prior) {
      var priorOwner = (prior && !historyStoreIsExpired(prior) && prior.ownerUserId) || null;
      var rec = historyStoreBuildRecord(scopeKey, ownerUserId, stack, index, priorOwner);
      return historyStoreIdbPut(rec).then(function (ok) {
        if (ok) historyStorePruneIdb(scopeKey); // fire-and-forget maintenance
        return ok;
      });
    });
  }).catch(function () { return false; });
}

/**
 * Read back the persisted stack for `scopeKey`. Resolves `null` when
 * nothing is stored, when the stored record has expired (>7 days since its
 * last write), or when it is owned by a DIFFERENT account than
 * `ownerUserId` — same gate as draftOwnedByCurrentAccount() in app.js.
 */
function historyStoreLoad(scopeKey, ownerUserId) {
  if (!scopeKey) return Promise.resolve(null);
  return historyStoreOpenDb().then(function (db) {
    if (!db) return historyStoreLoadLs(scopeKey, ownerUserId);
    return historyStoreIdbGet(scopeKey).then(function (rec) {
      return historyStoreValidateLoaded(rec, ownerUserId);
    });
  }).catch(function () { return null; });
}

/** Drop the persisted stack for one scope — called when that scope's site is
 * deleted (retireLocalDraftForDeletedSite() in app.js) or when a persisted
 * stack has gone stale against what was actually resumed. Clears BOTH
 * backends unconditionally (cheap belt-and-braces: a browser that once used
 * the localStorage fallback, e.g. IndexedDB was temporarily unavailable,
 * must not leave a stale copy behind there either). */
function historyStoreClearScope(scopeKey) {
  if (!scopeKey) return Promise.resolve();
  return historyStoreOpenDb().then(function (db) {
    var tasks = [historyStoreClearScopeLs(scopeKey)];
    if (db) tasks.push(historyStoreIdbDeleteMany([scopeKey]));
    return Promise.all(tasks);
  }).catch(function () { /* ignore */ }).then(function () { /* void */ });
}

/** Delete every persisted history record owned by `ownerUserId` — called
 * from wherever the account signs out or is deleted (doLogout()/
 * confirmLogoutEverywhere()/confirmDeleteAccount() → clearOwnedLocalDraftState()
 * in builder/app.js, the same place that clears hb.draft.scopes.v1) so a
 * same-tab account switch, "Deconectare de pe toate dispozitivele", or
 * account deletion never lets the next account (or nobody) Ctrl+Z back into
 * the previous one's edits. Clears both backends, same reasoning as
 * historyStoreClearScope() above. */
function historyStoreClearOwned(ownerUserId) {
  if (!ownerUserId) return Promise.resolve();
  return historyStoreOpenDb().then(function (db) {
    var tasks = [historyStoreClearOwnedLs(ownerUserId)];
    if (db) {
      tasks.push(historyStoreIdbGetAll(db).then(function (all) {
        var keys = all.filter(function (r) { return r && r.ownerUserId === ownerUserId; })
          .map(function (r) { return r.scopeKey; });
        return historyStoreIdbDeleteMany(keys);
      }));
    }
    return Promise.all(tasks);
  }).catch(function () { /* ignore */ }).then(function () { /* void */ });
}
