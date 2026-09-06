# Corecții la raportul de audit (2026-09-06)

Verificări făcute de orchestrator DUPĂ raport, la cererea owner-ului de a porni reconstrucțiile.
Regula raportului rămâne valabilă: 149 din 152 de constatări au venit de la un singur agent,
fără a doua confirmare. Iată prima verificată în profunzime — și infirmată.

---

## PS-01 [critical] „Editorul nu are model de document — inline-edit prin regex text-matching" — **INFIRMATĂ**

**Ce spunea constatarea:** editarea inline se face prin potrivire de text cu regex peste HTML-ul
deja randat, în `injectDataHb()` din `builder/app.js`, ceea ce ar fi cauza structurală a
defectelor cu carduri goale și DOM corupt, și motivul pentru care nu există undo, secțiuni
mutabile sau pagini multiple.

**De ce e greșită:**

1. `injectDataHb()` **nu e apelată de nicăieri**. Căutare pe tot repo-ul: apare o singură dată,
   la propria definiție (`builder/app.js:764`). Este cod mort, rămas dintr-o arhitectură veche.
2. Calea vie e alta: `builder/app.js:850` cheamă `renderPreview(..., { editMode: true })`, iar
   motorul de randare emite marcajele **la randare**, din token, deci cu calea exactă cunoscută:
   `build.js:317-320`, `replaceTokensWithEditMode` (`build.js:419`), `expandEach` cu `pathPrefix`
   pentru indici de listă (`build.js:549`). Comentariul de la `builder/app.js:848-849` spune
   explicit „modern edit-overlay".
3. **Probă empirică** (browser real, `main` la `b454fde`, șabloanele professionals și portfolio):
   - 99 de noduri editabile pe professionals, 85 de căi distincte; 96 și 82 pe portfolio.
   - Valori sub 3 caractere sunt editabile: `45`, `60`, `30`. Calea cu regex le sărea explicit
     (`value.length < 3`).
   - Valori pur numerice sunt editabile: `45`, `60`, `30`, `2026`. Calea cu regex le sărea
     explicit (`/^\d+$/`).
   - Texte duplicate sunt editabile la **toate** aparițiile (21 de duplicate; `labels.navGallery`
     apare de două ori, nav desktop și nav mobil, ambele marcate). Calea cu regex ambala doar
     prima apariție.

**Cum a apărut eroarea:** agentul a găsit funcția moartă și a confirmat-o încrucișat cu
`VISION.md` §4.6, care listează „edit mapping fragil prin regex" ca lacună cunoscută. Ambele
surse spuneau același lucru, ceea ce a arătat ca o coroborare. În realitate documentul era
stale (migrarea se făcuse, doc-ul nu fusese actualizat) iar codul era mort. Două surse învechite
care se confirmă reciproc produc încredere falsă — exact tiparul reproșat procesului de QA.

**Ce rămâne adevărat din consecințele enumerate:** lipsesc într-adevăr undo/redo
(`grep -cE '\bundo\b|\bredo\b' builder/app.js` → 0) și adăugarea/ștergerea/reordonarea de
SECȚIUNI (0 din 12 secțiuni au flag `removable`/`optional` în `templates/professionals/schema.json`).
Dar cauza nu e arhitectura de editare: `draft.config` **este** un model de document structurat,
iar randarea are deja proveniență. Sunt funcționalități neconstruite, nu o fundație greșită.

**Consecință pentru plan:** reconstrucția editorului nu se justifică. Se construiesc direct
funcționalitățile: undo/redo peste instantanee de `draft.config`, și secțiuni opționale prin
extinderea schemei.

---

## BE-05 / DI-02 [medium/high] „Registry pe un singur fișier JSON, citit și rescris integral" — **CONFIRMATĂ, și subevaluată**

`bot/registry.js:23-36`: `_load()` face `JSON.parse(readFileSync(...))` pe întreaga bază, iar
`_save()` serializează întreaga bază și o scrie prin tmp + rename. Fiecare mutație, oricât de
mică, face ambele. Scrierea e într-adevăr atomică, cum lăuda auditul, dar costul e liniar în
dimensiunea totală a bazei, nu în dimensiunea modificării.

Ce nu spunea constatarea: `saveVersion()` (`bot/registry.js:269-276`) stochează o **copie
completă a configului** la fiecare publicare, în același fișier. Iar configurile conțin imagini
ca `data:` URI base64 (constatare separată din lens-ul de strategie). Deci fișierul crește cu
câțiva megaocteți per publicare per site, și fiecare mutație ulterioară rescrie tot.

**Consecință pentru plan:** lucrarea se justifică, cu prioritate mai mare decât sugera severitatea
inițială.
