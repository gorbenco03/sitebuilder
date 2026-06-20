/*!
 * DessertCarousel v1.0 — reusable circular carousel widget
 * No dependencies. Vanilla JS, ES5-compatible (no arrow functions at module level).
 *
 * API:
 *   DessertCarousel.init(container, options) → instance
 *
 * Options:
 *   images    {string[]}  Array of image URLs. If omitted, reads <img src> from
 *                         child elements inside container.
 *   autoplay  {boolean}   Whether to auto-advance. Default: true.
 *   interval  {number}    Auto-advance interval in ms. Default: 3200.
 *
 * Multiple independent instances on one page are supported — no shared globals.
 */
(function (global) {
  'use strict';

  var DessertCarousel = {

    /**
     * Initialise a carousel inside `container`.
     *
     * @param {HTMLElement} container - The wrapper element.
     * @param {Object}      [options]
     * @param {string[]}    [options.images]   - Image URLs.
     * @param {boolean}     [options.autoplay] - Default true.
     * @param {number}      [options.interval] - Default 3200.
     * @returns {Object} Instance with .destroy() method.
     */
    init: function (container, options) {
      options = options || {};
      var autoplay = options.autoplay !== false;
      var interval = options.interval || 3200;

      // Resolve image list
      var images = options.images;
      if (!images || !images.length) {
        images = Array.prototype.slice.call(
          container.querySelectorAll('img')
        ).map(function (img) { return img.src; });
      }

      if (!images.length) {
        console.warn('DessertCarousel: no images found for', container);
        return null;
      }

      var N    = images.length;
      var step = 360 / N;

      // ── Build DOM structure ─────────────────────────────────────────────
      // Clear the container first (remove any seed <img> children)
      container.innerHTML = '';
      container.classList.add('dc-stage');

      // Cards
      var cards = images.map(function (src, i) {
        var card = document.createElement('div');
        card.className = 'dc-card';
        var img = document.createElement('img');
        img.src = src;
        img.alt = 'Carousel image ' + (i + 1);
        img.loading = 'lazy';
        card.appendChild(img);
        container.appendChild(card);
        return card;
      });

      // Controls wrapper (inserted after container in the DOM)
      var controls = document.createElement('div');
      controls.className = 'dc-controls';

      var prevBtn = document.createElement('button');
      prevBtn.className = 'dc-nav';
      prevBtn.setAttribute('aria-label', 'Anterior');
      prevBtn.innerHTML = '&#8249;';

      var dotsWrap = document.createElement('div');
      dotsWrap.className = 'dc-dots';

      var nextBtn = document.createElement('button');
      nextBtn.className = 'dc-nav';
      nextBtn.setAttribute('aria-label', 'Următor');
      nextBtn.innerHTML = '&#8250;';

      controls.appendChild(prevBtn);
      controls.appendChild(dotsWrap);
      controls.appendChild(nextBtn);

      var dots = images.map(function () {
        var d = document.createElement('span');
        d.className = 'dc-dot';
        dotsWrap.appendChild(d);
        return d;
      });

      container.parentNode.insertBefore(controls, container.nextSibling);

      // Lightbox — appended to <body> so no transformed ancestor affects
      // position:fixed and it always covers the full viewport
      var lightbox = document.createElement('div');
      lightbox.className = 'dc-lightbox';
      var lbImg = document.createElement('img');
      lbImg.alt = '';
      lightbox.appendChild(lbImg);
      document.body.appendChild(lightbox);

      // ── State ───────────────────────────────────────────────────────────
      var active = 0;
      var Rx = 520, Ry = 34, cardW = 220;
      var timer = null;

      // ── Layout ──────────────────────────────────────────────────────────
      function dims() {
        var w = container.clientWidth;
        cardW = Math.round(Math.max(135, Math.min(220, w * 0.30)));
        Rx    = Math.max(150, Math.min(540, w * 0.40));
        Ry    = Math.max(20,  Math.min(38,  w * 0.030));
        var cardH = cardW;
        cards.forEach(function (c) {
          c.style.width  = cardW + 'px';
          c.style.height = cardH + 'px';
          c.style.margin = (-cardH / 2) + 'px 0 0 ' + (-cardW / 2) + 'px';
        });
        container.style.height = Math.round(cardH * 1.35 + Ry * 2 + 40) + 'px';
      }

      function place() {
        var aAngle = active * step;
        cards.forEach(function (c, i) {
          var rad   = (i * step - aAngle) * Math.PI / 180;
          var depth = Math.cos(rad);          // 1 = front, -1 = back
          var t     = (depth + 1) / 2;        // 0 back .. 1 front
          var x     = Math.sin(rad) * Rx;
          var y     = depth * Ry;
          var s     = 0.64 + 0.36 * t;
          c.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + s + ')';
          c.style.opacity   = (0.34 + 0.66 * Math.pow(t, 1.3)).toFixed(3);
          c.style.filter    = 'brightness(' + (0.58 + 0.42 * t).toFixed(2) + ') saturate(' + (0.7 + 0.3 * t).toFixed(2) + ')';
          c.style.setProperty('--dc-veil', (0.42 * (1 - t)).toFixed(3));
          c.style.zIndex = String(Math.round(t * 200));
        });
        dots.forEach(function (d, i) {
          d.classList.toggle('dc-active', i === active);
        });
      }

      function render() { dims(); place(); }

      // ── Navigation ──────────────────────────────────────────────────────
      function goTo(i) { active = ((i % N) + N) % N; place(); resetAuto(); }
      function goNext() { active = (active + 1) % N; place(); }
      function goPrev() { active = (active - 1 + N) % N; place(); }

      // ── Autoplay ────────────────────────────────────────────────────────
      function startAuto() { stopAuto(); if (autoplay) timer = setInterval(goNext, interval); }
      function stopAuto()  { if (timer) { clearInterval(timer); timer = null; } }
      function resetAuto() { startAuto(); }

      // ── Lightbox ────────────────────────────────────────────────────────
      function openLightbox(src) {
        lbImg.src = src;
        lightbox.classList.add('dc-open');
        document.body.style.overflow = 'hidden';   // lock scroll behind lightbox
        stopAuto();
      }
      function closeLightbox() {
        lightbox.classList.remove('dc-open');
        document.body.style.overflow = '';
        startAuto();
      }

      // ── Card click ──────────────────────────────────────────────────────
      cards.forEach(function (card, i) {
        card.addEventListener('click', function () {
          if (i === active) {
            openLightbox(images[i]);
          } else {
            goTo(i);
          }
        });
      });

      // ── Buttons ─────────────────────────────────────────────────────────
      function onNext() { goNext(); resetAuto(); }
      function onPrev() { goPrev(); resetAuto(); }
      prevBtn.addEventListener('click', onPrev);
      nextBtn.addEventListener('click', onNext);

      // ── Keyboard ────────────────────────────────────────────────────────
      function onKey(e) {
        if (lightbox.classList.contains('dc-open')) {
          if (e.key === 'Escape') closeLightbox();
          return;
        }
        if (e.key === 'ArrowRight') { goNext(); resetAuto(); }
        if (e.key === 'ArrowLeft')  { goPrev(); resetAuto(); }
      }
      document.addEventListener('keydown', onKey);

      // ── Lightbox close ──────────────────────────────────────────────────
      lightbox.addEventListener('click', closeLightbox);

      // ── Drag / swipe — one card per gesture ─────────────────────────────
      var dragging = false, startX = 0, moved = false;
      function onPointerDown(e) { dragging = true; startX = e.clientX; moved = false; }
      function onPointerMove(e) {
        if (!dragging) return;
        var dx = e.clientX - startX;
        if (Math.abs(dx) > 50 && !moved) {
          moved = true;
          if (dx < 0) { goNext(); } else { goPrev(); }
          resetAuto();
        }
      }
      function onPointerUp() { dragging = false; }
      container.addEventListener('pointerdown',  onPointerDown);
      container.addEventListener('pointermove',  onPointerMove);
      container.addEventListener('pointerup',    onPointerUp);
      container.addEventListener('pointercancel', onPointerUp);

      // ── Resize ──────────────────────────────────────────────────────────
      function onResize() { render(); }
      window.addEventListener('resize', onResize);

      // ── Init ────────────────────────────────────────────────────────────
      render();
      startAuto();

      // ── Public instance API ─────────────────────────────────────────────
      return {
        goTo:    goTo,
        next:    function () { goNext(); resetAuto(); },
        prev:    function () { goPrev(); resetAuto(); },
        destroy: function () {
          stopAuto();
          document.removeEventListener('keydown', onKey);
          window.removeEventListener('resize', onResize);
          container.removeEventListener('pointerdown',   onPointerDown);
          container.removeEventListener('pointermove',   onPointerMove);
          container.removeEventListener('pointerup',     onPointerUp);
          container.removeEventListener('pointercancel', onPointerUp);
          if (lightbox.parentNode) lightbox.parentNode.removeChild(lightbox);
          if (controls.parentNode) controls.parentNode.removeChild(controls);
          container.innerHTML = '';
          container.classList.remove('dc-stage');
          document.body.style.overflow = '';
        }
      };
    }
  };

  global.DessertCarousel = DessertCarousel;
}(window));
