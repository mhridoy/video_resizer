# Binary Beat — Free File Tools

A searchable dashboard with **13 free tools**, including a Container Load Pack for shipment photos, videos, invoices and weight tickets, on **Windows, macOS and the web**. Filter by file type, choose a tool, and process files locally.

Batch resize and compress videos. Choose an entire folder, including subfolders, and convert every supported video to MP4. Originals are never changed.

Web app: https://video-resizer-eta.vercel.app/

## Use the app

1. Choose a folder or select multiple videos.
2. Pick **1080p**, **720p**, **480p**, or original dimensions.
3. Pick Balanced (default), Fastest, Smallest file, or Higher quality. Optionally set start/end seconds or remove audio under **Trim & audio**.
4. Click **Optimize videos**.

The desktop app saves to a new, timestamped folder inside Videos, or inside your selected output directory. Subfolders are preserved. Outputs include the source extension in their names, so `clip.mov` and `clip.mp4` cannot overwrite one another. Already generated `Video Resizer Output…` folders are excluded from scans.

The web app processes locally in your browser: no video upload, account, or server-side conversion. Download individual results from the queue. Chrome and Edge also offer **Save automatically to folder**, which preserves the input hierarchy and avoids keeping every result in memory. Do not close the tab while processing or before saving downloads.

## Container Load Pack

Prepare a container's load documentation so one email carries all of it. The limit is the **total of all attachments in one email** (24 MB by default), not a per-file size:

1. Open **Container Load Pack** and **Choose folder** (or drop it). Subfolders are included, so one run can cover several containers. You can also drop a **ZIP** — including a WhatsApp **Export chat** archive — and the photos, videos and documents inside it are imported directly, so you do not have to save each WhatsApp attachment by hand. The chat transcript and macOS junk files are ignored.
2. The container's files share that one budget. Files that already fit are left alone, invoices and weight tickets keep enough bytes to stay readable, and the video absorbs most of the squeeze (it is weighted to draw a larger share). A set too large to stay usable in one email is planned as several.
3. Container numbers are read from folder and file names (e.g. `CSQU3054383/…`) and checked against the ISO 6346 check digit. Files without one use the **default container number**.
4. Files are sorted into **Load photos, Load videos, Invoices, Weight tickets** and **Other documents** (names containing invoice, weight, VGM, ticket, kanta, B/L, packing… are recognised). Change any category in the table.
5. Click **Prepare files**. Every file comes out as its own file, ready to attach to an email one by one:
   - **Save** on any row saves that single file.
   - **Save all files** saves them individually to your Downloads folder.
   - **Save to folder** writes the container folder structure straight to disk (desktop app, Chrome or Edge).
   - A **ZIP** per container and a **CSV manifest** are there when a portal wants one, and when a container needs more than one email, each email's files are listed and saved together.

Mail servers measure the encoded message and base64 inflates attachments by about 37%, so **Leave room for encoding** targets the limit after encoding. Turn it on if a mail server rejects attachments that look small enough.

Output structure with standard names enabled:

```
CSQU3054383/
  CSQU3054383_manifest.csv
  01_Load_Photos/CSQU3054383_PHOTO_01.jpg
  02_Load_Videos/CSQU3054383_VIDEO_01.mp4
  03_Invoices/CSQU3054383_INVOICE_01.pdf
  04_Weight_Tickets/CSQU3054383_WEIGHT_01.jpg
  05_Documents/CSQU3054383_DOC_01.docx
```

| File type | When a file is over the limit |
| --- | --- |
| Photos (JPG, PNG, WebP, GIF, BMP, AVIF) | Lower quality step by step, then smaller dimensions. Transparent images become WebP. |
| Videos (MP4, MOV, MKV, AVI…) | MP4 (H.264/AAC) at a bitrate calculated from the duration, retried lower if needed. Desktop uses native FFmpeg (VideoToolbox on Mac). |
| PDF invoices and tickets | Lossless structural compression first; if still too large, pages are rendered at 110 → 60 DPI (text no longer selectable). |
| Word, Excel, PowerPoint, OpenDocument | Embedded pictures are reduced; text and layout are untouched. |

Files already within the limit are kept byte-for-byte. Originals are never modified, and nothing is uploaded.

## macOS downloads

- [Mac with Apple silicon (M1–M4)](https://github.com/mhridoy/video_resizer/releases/latest/download/Binary-Beat-macOS-arm64.dmg)
- [Mac with Intel](https://github.com/mhridoy/video_resizer/releases/latest/download/Binary-Beat-macOS-x64.dmg)

Open the DMG and drag **Binary Beat** to Applications. Builds are ad-hoc signed, not notarized (that requires a paid Apple Developer ID), so the first time right-click the app → **Open**, or use System Settings → Privacy & Security → **Open Anyway**. Requires macOS 11 or later. Mac builds don't auto-update; download new versions from the link above. Build locally on a Mac with `npm ci && npm run package:mac`.

## Windows downloads

**Direct downloads (no GitHub login needed):**

- [Windows installer EXE](https://github.com/mhridoy/video_resizer/releases/latest/download/Video-Resizer-Windows-Setup.exe)
- [Windows portable EXE](https://github.com/mhridoy/video_resizer/releases/latest/download/Video-Resizer-Windows-Portable.exe)

These links become available after the first successful build and release. Every successful main-branch build publishes a release with these stable asset names.

The website downloads the Windows installer from GitHub Releases. The Windows workflow builds both an installable Setup EXE and a portable EXE.

For individual build artifacts, open [Build Windows installer and web](https://github.com/mhridoy/video_resizer/actions/workflows/build.yml), choose the latest successful run, and download an artifact at the bottom:

| Artifact | Contents |
| --- | --- |
| Video-Resizer-Windows-x64 | Windows installer and portable EXE |
| Video-Resizer-Web | Static website build |

GitHub requires sign-in to download workflow artifacts, which are retained for 30 days. Run the workflow again to regenerate them. These initial builds are **unsigned**; Windows may display an unknown-publisher warning. Publishing trusted installers requires your signing certificates. The bundled FFmpeg needs no separate installation.

## Speed and quality

- Desktop uses native FFmpeg. It tries NVIDIA H.264 on Windows when present in the bundled encoder. If hardware fails, the file retries with CPU H.264.
- Balanced uses the `veryfast` CPU preset. The other profiles trade processing time for quality or file size. Hardware quality can differ from CPU output.
- The queue processes one file at a time to avoid exhausting memory and to keep the computer responsive.
- A minute count or percentage reduction cannot be guaranteed. Length, resolution, source codec, hardware, and settings determine the result. Already compressed files can become larger; the app reports actual input/output sizes.
- Resolution is a longest-edge cap: 1080p = 1920, 720p = 1280, and 480p ≈ 853 pixels, rounded to even dimensions. Portrait clips remain portrait. Smaller square-pixel videos are not enlarged. Non-square pixels are normalized to square pixels while preserving display aspect ratio as closely as even dimensions permit.
- Web uses a single-thread FFmpeg WASM engine. Its initial download is about 32 MB. Individual web inputs are limited to 1 GB, and lower limits can apply on memory-constrained devices. Large jobs belong in the desktop app.
- Output keeps the first video stream and first audio stream, if present. Subtitles, attachments, extra audio tracks and other data streams are not copied. This is for everyday videos, not archival preservation. HDR-to-SDR tone mapping is not included; use SDR source videos for predictable color.
- Cancellation preserves completed outputs and removes incomplete desktop outputs. Failed files are reported without stopping the rest of the batch. Click Optimize again to retry unfinished/failed files; completed files are skipped.

## Develop

Node.js 22.13+ and npm:

```sh
npm ci
npm run build
npm run desktop
```

For web development, run `npm run build` once to prepare the locally served video engine, then `npm run dev`. Production is the static `dist/` directory. Serve it over HTTPS; no backend, secrets, CDN runtime imports, or cross-origin isolation headers are required. WASM is split into sub-8-MB chunks at build time to fit static-host asset limits, then reconstructed locally in the browser.

```sh
npm test
npm run package
```

Package on the target operating system and CPU architecture. The workflow builds Windows x64, ensuring it receives the correct native FFmpeg binary. Outputs appear under `release/`. The app uses a sandboxed, context-isolated Electron renderer with a narrow IPC bridge; only files chosen through native dialogs can be processed by the native engine.

## Verification

`npm test` uses the bundled native FFmpeg and real generated video fixtures to check recursive discovery, invalid media, collision-safe output, source preservation, cancellation, landscape/portrait resizing, and no upscaling. Windows packaging is checked by GitHub Actions. GUI behavior and GPU encoding require testing on the corresponding operating systems; a successful cross-platform source build alone does not prove those paths.

See [THIRD_PARTY.md](THIRD_PARTY.md) for FFmpeg and dependency notices.

## Vercel hosting

Import this repository into Vercel. The included `vercel.json` builds the Vite web app to `dist/`, skipping desktop binary downloads during installation. Video processing stays on the user’s device; no conversion server is required. Connect the repository in Vercel for automatic deployments after future pushes.

### Local installer fallback

If hosted Actions cannot run, prepare `release/win-unpacked` with electron-builder on a build machine, install NSIS 3, and run `node scripts/build-local-installer.mjs`. Set `NSIS_BINARY` and `NSISDIR` if NSIS is not installed globally. This produces an unsigned per-user Setup EXE with Start Menu shortcuts and an uninstaller; it removes only packaged files and leaves user-created videos intact.

## Image and PDF tools

Binary Beat is free for everyone. Donations are not enabled yet. Use the tool cards to choose video resize, batch image resize (JPG/PNG/WebP), PDF merge, split or compression. All processing stays on your device, in the web and Windows apps.

PDF merge respects the displayed file order. Split accepts ranges such as `1-3,5;6-8`; blank ranges create one file per page. Quality-preserving PDF compression optimizes structure without downsampling images. Smaller-file mode renders pages as JPEGs (up to 100 DPI / 2400 pixels), losing selectable text, links, forms and signatures. It keeps the original if compression makes it larger. Merge/split are intended for ordinary documents; forms and bookmarks may not survive page copying. Password-protected files must be unlocked first. Image exports remove metadata and preserve aspect ratio without upscaling.

## Automatic Windows updates

Install the latest Setup EXE once to enable updates; older builds and portable EXEs cannot update themselves. Installed builds check GitHub Releases on launch and every four hours, download newer stable versions in the background, and install on normal app exit. They never force a restart. Use the **Updates** menu to see progress or check manually. Save image/PDF downloads before closing. Offline checks fail quietly and can be retried later.

CI stamps each Windows build with a strictly increasing `1.2.<run number × 100 + attempt>` version and publishes the Setup EXE, `latest.yml`, and blockmap together. Keep the app ID and GitHub update feed unchanged. This project is currently unsigned; signing certificates should be configured for trusted publisher verification.

## New dashboard and tools

- **Video:** compress, resize, trim, and mute. The four entry points choose useful starting settings for the same batch engine. Change resolution, quality, audio, and trim settings before processing. Trim and mute re-encode to MP4; they are not lossless stream-copy operations. Completed videos are retained and skipped by later runs; clear/reselect inputs to process them again with different settings.
- **Images:** resize, compress, convert JPG/PNG/WebP, or combine images into a PDF. Compression and conversion preserve pixel dimensions. Compression retains the original if the encoded result is larger. JPG fills transparency with white.
- **PDFs:** merge, split/extract, compress, rotate all or selected pages, and images-to-PDF. Rotation supports 90°, 180°, and 270° clockwise. Images can use A4 pages or pages matching image dimensions.
- **Batch controls:** drag/drop files, move items up/down, remove individual inputs, and download individual outputs or all results as a ZIP. ZIP creation is limited to 500 MB of combined output; larger results can be saved individually. Image/PDF batches allow up to 100 files, 200 MB per input, and 500 MB total input.
- **Navigation:** search by tool or keyword, filter Video/Image/PDF, and open browser links such as `#video-trim` or `#rotate`. Desktop navigation keeps the URL unchanged to preserve the trusted IPC boundary. Tool switching is blocked during processing.

## Performance changes

The dashboard loads only the interface. Video controls, image tools, PDF libraries, the PDF renderer, ZIP helper, and FFmpeg engine are loaded only when required. FFmpeg's initial download remains about 32 MB; it is not part of the homepage download. Browser video progress updates are throttled to keep long queues responsive. Cancelling during engine loading aborts downloads and terminates the worker; failed workers are cleaned up before retrying.

The Fastest profile uses the CPU/WASM `ultrafast` preset, trading file size for encoding speed. Trim seeks before decoding the input so discarded footage is skipped. Desktop encoder discovery is cached per binary; after hardware encoding fails, remaining files in that batch use CPU encoding. Folder auto-save chooses unique names when two inputs share a filename. Speed and output size still depend on the source and device; no fixed speed-up is promised.
