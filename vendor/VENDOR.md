# Vendored third-party code

Everything here is committed on purpose: the app must run from a plain static
host with no build step and no CDN, and keep working offline.

| Path | Package | Version | Notes |
|---|---|---|---|
| `pdfjs/pdf.min.mjs`, `pdfjs/pdf.worker.min.mjs` | `pdfjs-dist` | 6.5.438 | page rendering + text extraction |
| `pdfjs/cmaps/` | `pdfjs-dist` | 6.5.438 | needed to read CJK-encoded PDFs |
| `pdfjs/standard_fonts/` | `pdfjs-dist` | 6.5.438 | the standard 14 fonts when a PDF doesn't embed them |
| `pdfjs/wasm/`, `pdfjs/iccs/` | `pdfjs-dist` | 6.5.438 | JBIG2/JPEG2000 decoding + colour profiles (scanned scores) |
| `pdf-lib/pdf-lib.esm.min.js` | `pdf-lib` | 1.17.1 | writes the edited PDF |
| `fontkit/fontkit.bundle.mjs` | `fontkit` | 3.0.0 | **bundled**, see below |
| `fonts/NotoSansTC_400Regular.ttf` | `@expo-google-fonts/noto-sans-tc` | 0.4.4 | lazy-loaded, subset-embedded for Chinese text |

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
     --target=es2020 --minify --outfile=vendor/fontkit/fontkit.bundle.mjs
   ```

   Licences for everything bundled in are in `fontkit/NOTICE.txt`.

2. **It needs a small adapter.** pdf-lib 1.17 calls `subset.encodeStream()`
   (fontkit v1 API); fontkit 3 exposes `subset.encode()`. `js/fontkit-compat.js`
   bridges the two and is the only glue — see the comment at the top of it.

This combination is smaller than the broken one it replaced (380 KB, versus
714 KB of `@pdf-lib/fontkit` plus 224 KB of `pako`).

`test/export.test.mjs` renders a PDF containing every annotation type and
asserts the glyphs actually make it in, so a regression here fails loudly.

## Refreshing a library

```bash
npm pack pdfjs-dist@<ver>          # etc.
tar xzf <pkg>.tgz
cp package/build/pdf.min.mjs vendor/pdfjs/
```
Then re-apply the fontkit patch above if you bump `@pdf-lib/fontkit`, and
re-run `npm test`.
