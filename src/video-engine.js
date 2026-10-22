// Loads the browser video engine, preferring the multi-threaded build.
//
// FFmpeg compiled to WebAssembly decodes and encodes on one core by default, which is why a
// half-minute clip used to take minutes. The multi-threaded build uses every core, but it
// needs SharedArrayBuffer, which a browser only grants to a cross-origin-isolated page. The
// headers that grant it are set for the site; where they are missing — an older browser, or
// the page embedded somewhere else — this falls back to the single-threaded build.

let engine, ready = false, controller, loadedSingle = false;

export const threaded = () => globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer === 'function';
export const engineCores = () => threaded() ? Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4)) : 1;

export function currentEngine() { return ready ? engine : undefined; }

export function stopVideoEngine() {
  controller?.abort();
  engine?.terminate();
  engine = undefined; ready = false; controller = undefined;
}

/** Frees the engine only if `candidate` is the one still loaded (an error may have replaced it). */
export function dropEngine(candidate) {
  if (engine !== candidate) return;
  engine.terminate(); engine = undefined; ready = false;
}

/**
 * `single` forces the single-threaded build. The threaded one runs out of WebAssembly memory
 * on a large frame at a high bitrate, so a failed encode is retried on the smaller engine.
 */
export async function loadVideoEngine({ check = () => {}, status = () => {}, single = false } = {}) {
  const multi = !single && threaded();
  if (engine && ready && loadedSingle === !multi) return engine;
  if (engine) stopVideoEngine();
  status(multi
    ? `Loading the video engine (about 32 MB, using ${engineCores()} cores). This happens once per session.`
    : 'Loading the video engine (about 32 MB). This happens once per session.');
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  check();
  const loading = new FFmpeg(), abort = new AbortController();
  engine = loading; ready = false; controller = abort;
  let wasmURL;
  try {
    const base = new URL(multi ? './ffmpeg/mt/' : './ffmpeg/', document.baseURI);
    const get = async url => {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw Error('Could not download the video engine. Check your connection and retry.');
      return response;
    };
    const manifest = await (await get(new URL('core.json', base))).json();
    const parts = await Promise.all(manifest.chunks.map(async name => (await get(new URL(name, base))).arrayBuffer()));
    check();
    wasmURL = URL.createObjectURL(new Blob(parts, { type: 'application/wasm' }));
    await loading.load({
      coreURL: new URL('ffmpeg-core.js', base).href,
      wasmURL,
      ...(multi ? { workerURL: new URL('ffmpeg-core.worker.js', base).href } : {}),
    });
    check();
    ready = true; loadedSingle = !multi;
    return loading;
  } catch (error) {
    abort.abort(); loading.terminate();
    if (engine === loading) { engine = undefined; ready = false; }
    throw error;
  } finally {
    if (wasmURL) URL.revokeObjectURL(wasmURL);
    if (controller === abort) controller = undefined;
  }
}
