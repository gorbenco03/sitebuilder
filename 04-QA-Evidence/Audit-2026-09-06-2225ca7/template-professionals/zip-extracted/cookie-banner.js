/* Hidook cookie consent — dismissible, non-blocking essentials */
(function () {
  var KEY = 'hb-cookie-consent';
  var docBound = false;
  function readCookie() {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var s = parts[i].trim();
        if (s.indexOf(KEY + '=') === 0) return decodeURIComponent(s.slice(KEY.length + 1));
      }
    } catch (e) { /* ignore */ }
    return '';
  }
  function accepted() {
    try { if (localStorage.getItem(KEY)) return true; } catch (e) { /* private mode */ }
    var c = readCookie();
    if (c) {
      try { localStorage.setItem(KEY, c); } catch (e) { /* private mode */ }
      return true;
    }
    return false;
  }
  function persist() {
    try { localStorage.setItem(KEY, 'accepted'); } catch (e) { /* private mode */ }
    try { document.cookie = KEY + '=accepted; Path=/; Max-Age=31536000; SameSite=Lax'; } catch (e) { /* ignore */ }
  }
  function setOpenClass(on) {
    try {
      var root = document.documentElement;
      if (root && root.classList) {
        if (on) root.classList.add('hb-cookie-open');
        else root.classList.remove('hb-cookie-open');
      }
    } catch (e) { /* ignore */ }
    try {
      if (document.body && document.body.classList) {
        if (on) document.body.classList.add('hb-cookie-open');
        else document.body.classList.remove('hb-cookie-open');
      }
    } catch (e) { /* ignore */ }
  }
  function hideBanner() {
    var el = document.getElementById('hb-cookie-banner');
    if (!el) return;
    el.hidden = true;
    try { el.setAttribute('hidden', ''); } catch (e) { /* ignore */ }
    try { el.style.setProperty('display', 'none', 'important'); } catch (e) { /* ignore */ }
    try { el.setAttribute('data-hb-consent-dismissed', 'true'); } catch (e) { /* ignore */ }
    setOpenClass(false);
  }
  function accept(e) {
    // Avoid preventDefault: on pointerdown it can suppress the subsequent click
    // and confuse actionability in sandboxed srcdoc previews.
    persist();
    hideBanner();
  }
  function acceptTarget(t) {
    if (!t) return null;
    if (t.nodeType === 3) t = t.parentElement;
    if (!t || !t.closest) {
      return t && t.id === 'hb-cookie-accept' ? t : null;
    }
    return t.closest('#hb-cookie-accept');
  }
  function onActivate(e) {
    if (!acceptTarget(e && e.target)) return;
    accept(e);
  }
  function bindDocument() {
    if (docBound) return;
    docBound = true;
    // Capture-phase delegation survives node swaps and runs even when a
    // direct button listener was lost after a provisional srcdoc paint.
    // pointerdown fires before layout can cancel the click gesture.
    document.addEventListener('pointerdown', onActivate, true);
    document.addEventListener('click', onActivate, true);
  }
  function bindButton(btn) {
    if (!btn) return;
    if (btn.getAttribute('data-hb-bound') === '1') return;
    btn.setAttribute('data-hb-bound', '1');
    btn._hbBound = true;
    btn.addEventListener('pointerdown', accept);
    btn.addEventListener('click', accept);
    // Property handler: first trusted click must dismiss even if addEventListener
    // was dropped by a mid-load document replacement in catalog srcdoc previews.
    btn.onclick = accept;
  }
  function markReady(el) {
    if (!el) return;
    try { el.setAttribute('data-hb-consent-ready', 'true'); } catch (e) { /* ignore */ }
  }
  function show() {
    bindDocument();
    var el = document.getElementById('hb-cookie-banner');
    if (!el) return;
    if (accepted() || el.getAttribute('data-hb-consent-dismissed') === 'true') {
      hideBanner();
      markReady(el);
      return;
    }
    el.hidden = false;
    try { el.removeAttribute('hidden'); } catch (e) { /* ignore */ }
    try { el.style.removeProperty('display'); } catch (e) { /* ignore */ }
    setOpenClass(true);
    bindButton(document.getElementById('hb-cookie-accept'));
    markReady(el);
  }
  // Expose for inline fallback + preview-ready gating.
  try { window.__hbCookieAccept = accept; } catch (e) { /* ignore */ }
  bindDocument();
  if (document.getElementById('hb-cookie-banner')) show();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', show);
  } else {
    show();
  }
})();
