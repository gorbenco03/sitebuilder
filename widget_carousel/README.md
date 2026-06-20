# DessertCarousel — reusable circular carousel widget

A tilted-ellipse carousel with lightbox, drag/swipe, keyboard nav, and autoplay.
Framework-free vanilla JS + CSS. No npm, no bundler required.

---

## Quick start

1. Copy `carousel.css` and `carousel.js` into your project.
2. Link them in your HTML:

```html
<link rel="stylesheet" href="carousel.css">
<script src="carousel.js"></script>
```

3. Add an empty container element and call `init`:

```html
<div id="my-carousel"></div>

<script>
  DessertCarousel.init(document.getElementById('my-carousel'), {
    images: [
      'images/photo-1.jpg',
      'images/photo-2.jpg',
      'images/photo-3.jpg'
    ]
  });
</script>
```

---

## API

### `DessertCarousel.init(container, options)` → instance

| Parameter   | Type          | Default | Description                                      |
|-------------|---------------|---------|--------------------------------------------------|
| `container` | `HTMLElement` | —       | The wrapper element (will be cleared on init).   |
| `options`   | `Object`      | `{}`    | See options below.                               |

#### Options

| Key        | Type       | Default | Description                                                                                   |
|------------|------------|---------|-----------------------------------------------------------------------------------------------|
| `images`   | `string[]` | `[]`    | Array of image URLs. If omitted, reads `<img src>` from child elements inside the container. |
| `autoplay` | `boolean`  | `true`  | Auto-advance through images.                                                                  |
| `interval` | `number`   | `3200`  | Auto-advance interval in milliseconds.                                                        |

#### Returned instance

```js
const carousel = DessertCarousel.init(el, opts);

carousel.next();        // advance one step
carousel.prev();        // go back one step
carousel.goTo(index);   // jump to a specific image (0-based)
carousel.destroy();     // tear down: removes DOM, events, lightbox
```

---

## Multiple carousels on one page

Each call to `init` is fully independent — no shared globals between instances:

```html
<div id="carousel-a"></div>
<div id="carousel-b"></div>

<script>
  DessertCarousel.init(document.getElementById('carousel-a'), { images: [...] });
  DessertCarousel.init(document.getElementById('carousel-b'), { images: [...], interval: 5000 });
</script>
```

---

## CSS customisation

All styles use the `.dc-` prefix so they won't clash with your existing CSS.
Override variables or rules after loading `carousel.css`:

```css
/* Change accent colour */
.dc-nav        { background: #3a86ff; }
.dc-dot.dc-active { background: #3a86ff; }
```

Key class names:
- `.dc-stage`    — the carousel ring container
- `.dc-card`     — individual photo cards
- `.dc-controls` — prev/next buttons + dots row (inserted after the stage)
- `.dc-nav`      — prev / next buttons
- `.dc-dots`     — dot indicator row
- `.dc-dot`      — individual dot; `.dc-active` = current
- `.dc-lightbox` — full-screen lightbox overlay; `.dc-open` = visible

---

## Features

- Tilted elliptical ring — front cards large/bright, back cards small/dim
- Autoplay with configurable interval
- Prev / next arrow buttons
- Dot indicators
- Drag / swipe (one card per gesture)
- Keyboard arrows (ArrowLeft / ArrowRight); Escape closes lightbox
- Click front card → full-screen lightbox with scroll-lock
- Mobile lightbox: `position:fixed; inset:0` covers the full viewport, flex-centered, body scroll locked while open
- Responsive: card and ellipse sizes scale to container width
