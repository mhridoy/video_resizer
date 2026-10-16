# Third-party software

The MIT license covers the original application source only. Dependencies and bundled media engines retain their own licenses.

- Electron: MIT, https://github.com/electron/electron. Electron includes Chromium and its third-party notices.
- ffmpeg.wasm JavaScript wrapper: MIT, https://github.com/ffmpegwasm/ffmpeg.wasm.
- FFmpeg WASM core: built from FFmpeg and codec libraries, including GPL components such as x264. Build sources and configuration: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/docker.
- Native FFmpeg binary distribution: `ffmpeg-static` 5.2.0, https://github.com/eugeneware/ffmpeg-static. Binary build provenance is described by that package and its build release. The bundled executable's `-version` and `-buildconf` identify the actual build.
- FFmpeg license/source information: https://ffmpeg.org/legal.html and https://ffmpeg.org/download.html.

FFmpeg binaries and WASM cores are not relicensed as MIT by this application. Preserve bundled licenses and corresponding-source access when redistributing them. The package lockfile records exact dependency versions.

PDF editing uses pdf-lib (MIT). PDF rendering uses Mozilla PDF.js / pdfjs-dist (Apache-2.0). Their package license files are included with dependencies.

## Local shipment OCR

Tesseract.js and tesseract.js-core (Apache-2.0) provide local OCR. English trained data from @tesseract.js-data/eng is copied into the app at build time. Runtime worker and model files are served locally; shipment files are not sent to an OCR service. See the dependency packages for their license notices.

Pro shipment AI uses the Vercel AI SDK (`ai`, Apache-2.0) and AI Gateway. Model inference is an external service governed by the configured provider account terms; it is separate from the local OCR engine.

Local QR decoding uses jsQR (Apache-2.0), https://github.com/cozmo/jsQR. Decoded QR contents are used only to determine presence and are not opened or uploaded.
