/* fontkit-compat.js
 *
 * pdf-lib 1.17.1 was written against fontkit v1, whose subset objects exposed a
 * Node-style `encodeStream()`. fontkit v3 replaced that with a synchronous
 * `encode()` returning a Uint8Array, so pdf-lib throws
 * "subset.encodeStream is not a function".
 *
 * We use fontkit v3 anyway, because the maintained-until-2020 `@pdf-lib/fontkit`
 * fork silently produces broken subsets for large CJK fonts: the glyph data for
 * most characters is dropped while the ToUnicode map still claims them, so text
 * extracts correctly but renders blank. fontkit v3 subsets the same font
 * correctly (verified in test/export.test.mjs).
 *
 * This adapter is the whole bridge: re-expose `encode()` as the stream shape
 * pdf-lib reaches for. Emission is deferred by a microtask because pdf-lib
 * chains `.on('data').on('end').on('error')` synchronously after the call.
 */

import * as fontkit from '../vendor/fontkit/fontkit.bundle.js';

function withEncodeStream(subset) {
  if (typeof subset.encodeStream === 'function') return subset;

  subset.encodeStream = () => {
    const handlers = {};
    const emitter = {
      on(event, cb) { handlers[event] = cb; return emitter; },
    };
    queueMicrotask(() => {
      try {
        const bytes = subset.encode();
        handlers.data?.(bytes);
        handlers.end?.();
      } catch (err) {
        if (handlers.error) handlers.error(err);
        else throw err;
      }
    });
    return emitter;
  };
  return subset;
}

/** Drop-in replacement for `@pdf-lib/fontkit` in `doc.registerFontkit()`. */
const fontkitCompat = {
  ...fontkit,
  create(...args) {
    const font = fontkit.create(...args);
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => withEncodeStream(createSubset());
    return font;
  },
};

export default fontkitCompat;
