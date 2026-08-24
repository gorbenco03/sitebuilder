---
version: alpha
name: Hidook Site Builder
description: Paper-and-ink product for Romanian local businesses. Catalog-first landing, quiet builder chrome, photography-led templates. Not indigo SaaS, not Awwwards WebGL, not a clone of any reference.
colors:
  primary: "#14120F"
  secondary: "#5C564E"
  tertiary: "#9A4030"
  neutral: "#F3EFE8"
  paper: "#F3EFE8"
  ink: "#14120F"
  ink-muted: "#5C564E"
  accent: "#9A4030"
  accent-hover: "#7C3226"
  forest: "#1E3A32"
  line: "#D9D2C6"
  surface: "#FFFcf7"
  focus: "#1E3A32"
typography:
  h1:
    fontFamily: Newsreader
    fontSize: 3.25rem
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  h2:
    fontFamily: Newsreader
    fontSize: 2rem
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body-md:
    fontFamily: Geist
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  ui:
    fontFamily: Geist
    fontSize: 0.875rem
    fontWeight: 500
    letterSpacing: "0.01em"
  label:
    fontFamily: Geist
    fontSize: 0.6875rem
    fontWeight: 600
    letterSpacing: "0.12em"
rounded:
  sm: 2px
  md: 8px
  lg: 12px
spacing:
  sm: 8px
  md: 16px
  lg: 32px
  xl: 64px
  section: 96px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFcf7"
    rounded: "{rounded.md}"
    padding: 14px
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFcf7"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 14px
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    padding: 4px
---

# DESIGN.md: Hidook Site Builder (art direction)

## Source

- Derived from 11 Firecrawl DESIGN.md extracts + full-page screenshots captured 2026-08-25.
- References (internal evidence only): `refs/DESIGN-*.md`, `.firecrawl/*-screenshot.png`.
- Current product (do not keep): `s69` builder `app.css` — `#FAFAF9` / `#111827` / `#5B5BD6`, system-ui, 16–20px radii, 180px template thumbs, badge “Builder + hosting gestionat”.
- Production must **adapt this system**. Do not ship reference logos, photos, fonts that are unlicensed, or competitor copy. Owned template renders + client uploads only unless the owner names a licensed asset.

## Overview

Hidook is a **browser site builder for local businesses** (restaurant / portfolio / local service / later professionals). The stranger journey is:

`open builder → choose a design → edit copy/images → Instagram before pay → sign in → pay 100 → live HTTPS → edit → republish` (renewal 29/year).

The current landing fails as **art direction**, not polish: it looks like a generic generated SaaS (indigo accent, system-ui, skeleton cards, tech badge). High-end 2026 references win with **one honest picture of the product**, **display type with real contrast**, **asymmetric or overlapping catalog previews**, and **almost no chrome**.

Two surfaces, one language:

1. **Landing + catalog** (stranger) — paper, serif display, overlapping real template previews, one ink CTA. Closest grammar: Squarespace fold + Awwwards featured preview + Webflow 3-up proof.
2. **Builder chrome** (editor topbar, publish modal, details drawer) — Linear density on **paper**, not dark-mode tool cosplay. The customer’s site is the image; chrome is hairline.

Restaurant / cafe **templates** follow Ballena + Dishoom + Gilli + Giacosa + Joakim: photography first, Reserve persistent, dual Meniu/Rezervă, cream or near-black polarity. Not bakery chalkboard, not DESSERD, not indigo.

## Colors

- **Paper `#F3EFE8`:** landing canvas. Warmer and dirtier than `#FAFAF9`. Matches Dishoom cream / Ballena sand, not Material gray.
- **Ink `#14120F`:** headlines, primary button, key UI. Near-black with a brown cast — not `#111827` cool gray.
- **Ink-muted `#5C564E`:** body and meta. Must stay ≥4.5:1 on paper.
- **Accent `#9A4030`:** terracotta for emphasis (em words, text links, restaurant CTAs). From Ballena/Joakim clay family, **not** Stripe `#533AFD` or Hidook `#5B5BD6`.
- **Forest `#1E3A32`:** alternate quiet accent for professionals / local-service; focus ring. Not Webflow blue.
- **Line `#D9D2C6`:** hairline borders. No 1px `#E5E7EB` on white.
- **Do not use** `#5B5BD6`, `#EEF2FF`, lime slabs, purple gradients, or raw `#0000EE`.

## Typography

- **Display:** Newsreader (or Fraunces if Newsreader unavailable). 52–72px desktop, 36–44px mobile, weight 500, tracking −0.03em, line-height 1.05. Two lines max on the fold.
- **UI / body:** Geist (or Inter). 14–16px, weight 400–500. Labels 11px, 0.12em tracking, sentence case or small caps — not bold uppercase pills.
- **Do not** set the product in system-ui only. **Do not** color the italic word in indigo.
- Romanian diacritics must render (Newsreader/Geist cover ăîâșț).

## Layout

Landing section order (desktop 1280–1440):

1. Thin mast: wordmark left · 2–3 text links · one ink button `Începe` / `Alege un design`.
2. **Fold:** display headline (product job, not “builder platform”) + one sentence with **true** price 100 / 12 months / 29 renewal + **overlapping owned template previews** (center card ~720–880px wide, neighbors 15–20% cropped). No tech badge.
3. Quiet vertical chips: Restaurant · Portofoliu · Servicii locale · (Professionals when shipped).
4. Catalog: 2-col desktop / 1-col mobile. Each card is a **full designed site crop** ≥ 360px tall, name + one-line use, no 180px letterbox.
5. Proof row of **true** facts only (pay before live, HTTPS, edit after pay). No fake 7M users.
6. How it works: 4 short steps matching the real journey. No “AI agent” claims.
7. Footer: legal, price again, no DESSERD, no raw hostnames as brand.

Builder chrome:

- Header 56px, editor topbar 52px — keep heights, restyle tokens.
- One primary `Publică site-ul` (ink). Secondary actions are text+icon, not competing filled buttons.
- Details drawer: paper surface, 12px title, 14px fields, 8px radius inputs.
- Publish modal: no lavender icon tile; use a quiet checklist and the slug field as the hero.

Grid: 12-col, max 1200–1280 content, section padding 80–120px desktop / 48px mobile. Base 8.

## Elevation & Depth

- Almost no drop-shadow. Overlap and crop create depth (Squarespace neighbors).
- If a shadow exists: `0 12px 40px rgba(20,18,15,.08)` on the featured preview only.
- Hairline `1px solid #D9D2C6`. Focus: 2px forest ring, offset 2px.

## Shapes

- Product UI radius 8px. Media 2–8px. Pills only for the single primary button if needed — prefer rounded-rect 8px over 999px.
- Restaurant templates: 0–8px. No 20px SaaS cards.

## Components

- **Primary button:** ink fill, paper text, 14px/500, min height 44px, min width 44px.
- **Ghost:** ink hairline or text-only (`Meniu`, `Vezi exemplu`).
- **Template card:** image is 70–80% of the card. Hover: 1.015 scale, 180ms, no indigo border.
- **Price:** in the sentence, not a rainbow tag. `100` and `29` stay honest.
- **Nav:** text links, current state = underline or weight 600, not lilac chip.

## Do's and Don'ts

Do:

- Show the product as **designed sites**, not empty skeletons.
- Keep pay-before-publish, 100/29, Instagram-before-pay, edit/republish.
- Respect `prefers-reduced-motion`. CSS transitions ≤ 220ms.
- Align Professionals calendar later to this paper/ink language.

Don't:

- Ship WebGL, GSAP scroll hijack, cookie walls as art, or Framer/Linear dark landing.
- Use “Builder + hosting gestionat”, DESSERD, factory/bakery stock, raw tech labels.
- Clone Botanica, Dishoom photos, Gilli chocolates, Ballena architecture, Stripe wash.
- Invent testimonials or user counts.
- Recolor indigo to terracotta and call it done — hierarchy and catalog crops must change.
