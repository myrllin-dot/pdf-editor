# Tests

Two layers, both runnable from this folder.

```bash
mkdir -p out
node export.test.mjs        # headless: the PDF-writing path
```

`export.test.mjs` builds a two-page source PDF (page 2 deliberately `/Rotate 90`),
applies one annotation of every type — including multi-line CJK, faux-bold CJK,
an auto-upgraded font, and a rotated watermark — then writes `out/edited.pdf`.
Render it and look at it:

```bash
pdftoppm -png -r 100 out/edited.pdf out/page
pdftotext out/edited.pdf -        # proves text is real text, not raster
```

This is the test that catches silent font-subsetting corruption, where text
extracts perfectly but renders blank. Compare the PNG, not just the text dump.

## Browser tests

These need Chrome and `puppeteer-core` (`npm i puppeteer-core`), plus the app
served locally:

```bash
python3 -m http.server 8777     # from the repo root, in another shell
node ui.test.mjs                # loads the app, opens a PDF, screenshots
node e2e.test.mjs               # drives every tool, saves, captures the download
```

`e2e.test.mjs` is the one that matters: it clicks through editing existing text,
pen, arrow, highlighter, a text box and a batch footer, then exports and leaves
the result in `out/dl/`. Open that PDF and compare it with `out/ui-3-annotated.png` —
they should match.

## OCR tests

```bash
node mkscan.mjs          # builds out/scanned.pdf: an image-only page, no text layer
node ocr.test.mjs        # recognises it, prints lines + boxes + confidence
node ocr-lang.mjs        # compares chi_tra / eng+chi_tra / chi_tra+eng accuracy
node ocr-edit.test.mjs   # the real flow: OCR -> click a line -> correct it -> export
node v2.test.mjs         # shapes + thumbnail rail
```

`ocr-lang.mjs` is the one to re-run if anyone proposes changing the default
language handling — it is the evidence that mixing languages wrecks Chinese
accuracy. `mkscan.mjs` needs Pillow (`pip install pillow`) to draw the fixture.

## Text styling

```bash
node textfx.test.mjs     # every effect through the PDF writer -> out/textfx.pdf
pdftoppm -png -r 110 out/textfx.pdf out/textfx
```

Render it and look at it. It lays out bold / italic / underline, outline,
hollow, echo, letter spacing, line spacing, frames with wrapping (Latin and
CJK), alignment and all nine anchors on one page, so a regression in
`js/textlayout.js` or the PDF text operators is visible at a glance.

The companion check is that the canvas preview matches: `preview.test.mjs`
(in the dev scratch set) renders the identical annotation list through
`overlay.js` so the two images can be compared side by side.
