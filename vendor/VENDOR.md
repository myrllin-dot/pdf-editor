# Vendored third-party code

Everything here is committed on purpose: the app must run from a plain static
host with no build step and no CDN, and keep working offline.

| Path | Package | Version | Notes |
|---|---|---|---|
| `pdfjs/pdf.min.js`, `pdfjs/pdf.worker.min.js` | `pdfjs-dist` | 6.5.438 | page rendering + text extraction |
| `pdfjs/cmaps/` | `pdfjs-dist` | 6.5.438 | needed to read CJK-encoded PDFs |
| `pdfjs/standard_fonts/` | `pdfjs-dist` | 6.5.438 | the standard 14 fonts when a PDF doesn't embed them |
| `pdfjs/wasm/`, `pdfjs/iccs/` | `pdfjs-dist` | 6.5.438 | JBIG2/JPEG2000 decoding + colour profiles (scanned scores) |
| `pdf-lib/pdf-lib.esm.min.js` | `pdf-lib` | 1.17.1 | writes the edited PDF |
| `fontkit/fontkit.bundle.js` | `fontkit` | 3.0.0 | **bundled**, see below |
| `fonts/NotoSansTC_400Regular.ttf` | `@expo-google-fonts/noto-sans-tc` | 0.4.4 | lazy-loaded, subset-embedded for Chinese text |
| `tesseract/tesseract.esm.min.js`, `worker.min.js` | `tesseract.js` | 7.0.0 | OCR for scanned pages |
| `tesseract/core/*.wasm.js` | `tesseract.js-core` | 7.0.0 | **must match tesseract.js's major**, see below |
| `tesseract/lang/*.traineddata.gz` | `@tesseract.js-data/{eng,chi_tra}` | 1.0.0 | `4.0.0_best_int` models |

## Why fontkit 3 and not `@pdf-lib/fontkit`

pdf-lib's own docs point at `@pdf-lib/fontkit`. We don't use it. That fork was
last published in 2020 and **silently produces broken subsets** for large CJK
fonts: the subset font program loses the glyph outlines for most characters
while the `ToUnicode` map still lists them. The symptom is nasty — the text
extracts and searches perfectly but renders as blank space, so the damage is
invisible until someone opens the PDF. Measured on Noto Sans TC, a 31-character
string came back with 3 glyphs drawn.

Upstream `fontkit@3` subsets the same font correctly. Two consequences:

1. **It needs bundling.** Neither the `dist/browser` build nor the main entry is
   self-contained — both leave bare specifiers for `restructure`,
   `unicode-properties`, `unicode-trie`, `dfa`, `fflate` and `brotli`. The
   committed file is the bundler output:

   ```bash
   echo "export * from 'fontkit';" > fk-entry.mjs
   npx esbuild fk-entry.mjs --bundle --format=esm --platform=browser \
     --target=es2020 --minify --outfile=vendor/fontkit/fontkit.bundle.js
   ```

   Licences for everything bundled in are in `fontkit/NOTICE.txt`.

2. **It needs a small adapter.** pdf-lib 1.17 calls `subset.encodeStream()`
   (fontkit v1 API); fontkit 3 exposes `subset.encode()`. `js/fontkit-compat.js`
   bridges the two and is the only glue — see the comment at the top of it.

This combination is smaller than the broken one it replaced (380 KB, versus
714 KB of `@pdf-lib/fontkit` plus 224 KB of `pako`).

`test/export.test.mjs` renders a PDF containing every annotation type and
asserts the glyphs actually make it in, so a regression here fails loudly.

## Tesseract: two things that will bite

**The core version must track tesseract.js.** `tesseract.js@7` asks its worker
for `tesseract-core-relaxedsimd-lstm.wasm.js`, a file that does not exist in
`tesseract.js-core@6`. Pairing them gives an opaque `importScripts` failure
rather than a version error. All three LSTM variants
(`relaxedsimd`, `simd`, plain) are committed because the worker picks one at
runtime from CPU feature detection, and a variant that is missing 404s instead
of falling back. Only one is ever downloaded by a given browser. The `.wasm.js`
files embed their wasm as base64, so no separate `.wasm` is needed.

**The small language models are the right ones.** `@tesseract.js-data` ships
both `4.0.0` (26 MB for `chi_tra`) and `4.0.0_best_int` (1.6 MB). On a Chinese
test scan the two produced *character-for-character identical* output, so the
16× larger file buys nothing and the quantised model is committed. If accuracy
ever needs re-examining, re-run that comparison rather than assuming bigger is
better.

Also note `tesseract.esm.min.js` exposes its API on a single **default** export
(`createWorker` et al. hang off `.default`), not as named exports.

## Why `.js` and not `.mjs`

The pdf.js and fontkit bundles are ES modules but are committed with a `.js`
extension on purpose. GitHub Pages' `Content-Type` for `.mjs` is not something
to rely on, and a browser refuses a module script served as anything other than
a JavaScript MIME type — which would break the whole app on deploy while
working perfectly from a local server. `.js` is served as `text/javascript`
everywhere. pdf.js builds its worker with an explicit `{ type: "module" }`
rather than sniffing the extension, so nothing depends on the `.mjs` name.

## Refreshing a library

```bash
npm pack pdfjs-dist@<ver>          # etc.
tar xzf <pkg>.tgz
cp package/build/pdf.min.mjs vendor/pdfjs/pdf.min.js
```
Then re-apply the fontkit patch above if you bump `@pdf-lib/fontkit`, and
re-run `npm test`.
