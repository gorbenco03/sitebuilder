'use strict';
/*
 * builder/a11y-focus.js — keyboard containment for modal surfaces, and the
 * skip link's behaviour.
 *
 * 1. Tab and Shift+Tab stay inside the topmost open modal.
 * 2. The skip link (WCAG 2.4.1 Bypass Blocks) moves focus to the visible
 *    main region.
 */
(function () {
  var FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function visible(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function focusablesIn(root) {
    var out = [];
    var list = root.querySelectorAll(FOCUSABLE);
    for (var i = 0; i < list.length; i++) if (visible(list[i])) out.push(list[i]);
    return out;
  }

  /* The topmost modal surface currently on screen, or null. */
  function activeSurface() {
    var candidates = [];
    var modals = document.querySelectorAll('.modal, [role="dialog"]');
    for (var i = 0; i < modals.length; i++) {
      if (visible(modals[i]) && !modals[i].hasAttribute('data-a11y-not-modal')) candidates.push(modals[i]);
    }
    if (!candidates.length) return null;
    // Highest painted wins.
    candidates.sort(function (a, b) {
      var za = parseInt(window.getComputedStyle(a).zIndex, 10) || 0;
      var zb = parseInt(window.getComputedStyle(b).zIndex, 10) || 0;
      return za - zb;
    });
    return candidates[candidates.length - 1];
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var surface = activeSurface();
    if (!surface) return;
    var items = focusablesIn(surface);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var current = document.activeElement;

    // Focus outside the surface entirely — pull it back rather than let the
    // browser continue into the page behind the overlay.
    if (!surface.contains(current)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && current === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  }, true);

  /* Skip link: send focus to whichever screen is currently the main region.
   * Three screens share role="main" and only one is ever displayed. */
  function mainRegion() {
    var mains = document.querySelectorAll('[role="main"]');
    for (var i = 0; i < mains.length; i++) if (visible(mains[i])) return mains[i];
    return null;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var link = document.getElementById('skip-to-content');
    if (!link) return;
    link.addEventListener('click', function (e) {
      var target = mainRegion();
      if (!target) return;
      e.preventDefault();
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
      target.scrollIntoView({ block: 'start' });
    });
  });
})();
