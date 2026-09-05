# Third-party software

The MIT license covers the original application source only. Dependencies and bundled media engines retain their own licenses.

- Electron: MIT, https://github.com/electron/electron. Electron includes Chromium and its third-party notices.
- ffmpeg.wasm JavaScript wrapper: MIT, https://github.com/ffmpegwasm/ffmpeg.wasm.
- FFmpeg WASM core: built from FFmpeg and codec libraries, including GPL components such as x264. Build sources and configuration: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main and https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/docker.
- Native FFmpeg binary distribution: `ffmpeg-static` 5.2.0, https://github.com/eugeneware/ffmpeg-static. Binary build provenance is described by that package and its build release. The bundled executable's `-version` and `-buildconf` identify the actual build.
- FFmpeg license/source information: https://ffmpeg.org/legal.html and https://ffmpeg.org/download.html.

FFmpeg binaries and WASM cores are not relicensed as MIT by this application. Preserve bundled licenses and corresponding-source access when redistributing them. The package lockfile records exact dependency versions.
