# Authored Grant street reflection environment

`source.js` constructs original opposing facades, windows and foliage and renders a 360-degree environment. These are inferred reflection details, not mapped objects or photographic pixels. `street.hdr` is the offline runtime output.

Rebuild from the repository checkout with `node assets/environments/grant-street/build.mjs` from the example directory. This uses the existing esbuild and Playwright tools plus local Chromium. Set `CHROMIUM_PATH` if needed. The bake serves only a temporary local script and makes no external requests.

The bake now encodes Radiance scanlines with lossless RLE (`rgbe-rle.mjs`). The current 2048 by 1024 map shrank from 8,388,659 bytes to 664,130 bytes. Both an independent scanline decoder and the pinned Three.js RGBELoader returned identical pixel values before/after. This changes storage only, not the original inferred reflection environment or exposure.
