'use strict';
/*
 * builder/a11y-focus.js — keyboard containment for the editor's modal surfaces,
 * and the skip link's behaviour.
 *
 * Two things this fixes, both measured by driving the real app:
 *
 * 1. The details drawer is modal for a mouse and porous for a keyboard. It has
 *    a full-screen overlay at z-index 450 whose click handler closes it, so a
 *    sighted mouse user cannot reach anything behind it. A keyboard user tabbed
 *    straight through: 14 of 30 Tab presses landed on the topbar behind the
 *    curtain, on controls they could neither see the focus ring against nor
 *    click. The same applies to the publish/success/gallery modals.
 *
 * 2. There was no way to skip the chrome. The landing page puts a nav before
 *    its content and the editor puts seventeen toolbar controls before the
 *    canvas, so reaching the thing you came for meant tabbing past all of it,
 *    every time. WCAG 2.4.1 Bypass Blocks is Level A.
 *
 * Deliberately its own file rather than an addition to app.js: this is one
 * concern, it needs no application state, and app.js is 7000 lines.
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

  /* The topmost modal surface currently on screen, or null.
   * Order matters: a modal opened from the drawer sits above it. */
  function activeSurface() {
    var candidates = [];
    var modals = document.querySelectorAll('.modal, [role="dialog"]');
    for (var i = 0; i < modals.length; i++) {
      if (visible(modals[i]) && !modals[i].hasAttribute('data-a11y-not-modal')) candidates.push(modals[i]);
    }
    var drawer = document.getElementById('details-drawer');
    var overlay = document.getElementById('drawer-overlay');
    if (drawer && visible(drawer) && overlay && visible(overlay)) candidates.push(drawer);
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
