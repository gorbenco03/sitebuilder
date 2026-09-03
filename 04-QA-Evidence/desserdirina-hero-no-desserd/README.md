# Desserdirina hero — no DESSERD leak

## Defect
Seed copy was Desserdirina / București, but `templates/desserdirina/images/hero.jpg`
still showed a wooden disc «DESSERD by Irina» + Facebook mark (rejected root sample).

## Fix
Top-anchored crop of the seed hero (remove bottom board/badge). Root `images/hero.jpg`
left untouched as the rejected sample reference.

## Oracle
`node bot/test/desserdirina-hero-no-desserd.test.js`
- seed hero SHA ≠ root sample
- Vision OCR on seed file clean
- root sample still OCRs DESSERD (sensitivity)
- editor mobile-preview 390 canvas OCR clean + keeps Desserdirina wordmark

## Stranger proof (this folder)
- `editor-mobile-preview-390-hero.png` + `ocr-editor-390.txt`
- `live-site-390.png` + `ocr-live-390.txt` (test-pay isolated `/live/…` at 390×844)
- OCR reads Desserdirina / TORTURI… only — no DESSERD / by Irina
