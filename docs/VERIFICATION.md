# Redesign verification

Tested locally on macOS with Node 23.7.0, using the locked dependencies. Baseline: commit `edf48b5`.

## Automated checks

`npm test`: 21 passing tests, 0 failures. These include real native FFmpeg and WASM fixtures, trim/mute output, aspect ratio and no-upscaling, source preservation, invalid inputs, cancellation cleanup, encoder caching and hardware fallback, PDF page order/rotation, image dimension rules, update behavior, and ZIP checksums/central-directory integrity.

`npm run build`: production Vite build passes. No new runtime dependencies.

`git diff --check`: passes.

## Browser checks

Verified the production build served through Vite preview, with the repository Content Security Policy:

- Dashboard loads with all 12 tools, without console warnings or errors.
- Search narrows the directory to matching tools; category filters show their tools.
- Resize two 1200×800 PNG images to 600×400 JPG outputs: both results and sizes shown correctly.
- PDF rotation with page range `2`: a valid result link and completion status appear. Automated tests separately inspect page rotation values.
- A four-second video processed with start=1, end=2.5, mute enabled, and Fastest profile: batch completes and exposes an MP4 download. Automated native/WASM tests separately verify trimmed duration and absence of audio.
- ZIP creation completes and the UI starts its download. The embedded browser did not expose a download event to automation, so operating-system save completion was not verified. Archive structure and CRCs are covered by automated tests.
- Responsive dashboard and video workspace inspected at 390×844; no horizontal overflow.

## Initial download comparison

Both baseline and redesign were built with the same installed dependency versions. These are the HTML-linked JavaScript and CSS assets, not the full deferred processing libraries or a timing benchmark:

| Initial assets | Baseline | Redesign (approximately) |
| --- | ---: | ---: |
| JavaScript, uncompressed | 448.8 KB | 10 KB |
| JavaScript + CSS, uncompressed | 458.5 KB | 33.5 KB |
| JavaScript + CSS, gzip | 188.5 KB | 10 KB |

The dashboard JavaScript is approximately 98% smaller because PDF and video code loads on demand. FFmpeg's first-use download remains approximately 32 MB. Encoding speed and compression ratio depend on the source and device.

## Platform checks still needed

- Windows installed and portable builds, NVIDIA acceleration, and updater integration on Windows hardware.
- OS download completion in a standalone browser and native folder auto-save permissions.
- Slow-network cancellation during initial FFmpeg download, plus low-memory/mobile stress tests on real devices.

No live deployment or GitHub push was performed as part of this local build.
