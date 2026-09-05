const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const optionsModule = import('../shared/options.mjs');

async function scanFolder(root) {
  const { isVideo } = await optionsModule;
  const files = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !entry.name.startsWith('Video Resizer Output')) await visit(full);
      else if (entry.isFile() && isVideo(entry.name)) {
        const stat = await fs.stat(full);
        files.push({ id: randomUUID(), path: full, name: path.relative(root, full), size: stat.size });
      }
    }
  }
  await visit(root);
  return files;
}

function getEncoders(binary) {
  return new Promise(resolve => execFile(binary, ['-hide_banner', '-encoders'], { windowsHide: true }, (err, stdout) => resolve(err ? '' : stdout)));
}

class BatchEngine {
  constructor(binary, onEvent) { this.binary = binary; this.onEvent = onEvent; this.running = false; this.cancelled = false; this.child = null; }
  cancel() { this.cancelled = true; this.child?.kill(); }
  async run(files, outputRoot, rawOptions) {
    if (this.running) throw new Error('A batch is already running.');
    this.running = true; this.cancelled = false;
    try {
      const { validateOptions, encodingArgs } = await optionsModule;
      const options = validateOptions(rawOptions);
      this.encodingArgs = encodingArgs;
      await fs.mkdir(outputRoot, { recursive: true });
      const supported = options.hardware ? await getEncoders(this.binary) : '';
      const encoder = process.platform === 'darwin' && supported.includes('h264_videotoolbox') ? 'h264_videotoolbox'
        : process.platform === 'win32' && supported.includes('h264_nvenc') ? 'h264_nvenc' : 'libx264';
      for (const file of files) {
        if (this.cancelled) break;
        const relative = file.name;
        if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe relative path.');
        // Include the original extension to keep foo.mov and foo.mp4 distinct.
        let target = path.join(outputRoot, `${relative}.optimized.mp4`);
        await fs.mkdir(path.dirname(target), { recursive: true });
        try { await fs.access(target); target = path.join(path.dirname(target), `${path.basename(target, '.mp4')}-${randomUUID().slice(0, 8)}.mp4`); } catch {}
        const temporary = `${target}.${randomUUID()}.part.mp4`;
        this.onEvent({ id: file.id, status: 'processing', progress: 0, encoder });
        try {
          try { await this.convert(file, temporary, options, encoder); }
          catch (error) {
            if (encoder === 'libx264' || this.cancelled) throw error;
            this.onEvent({ id: file.id, status: 'processing', progress: 0, encoder: 'libx264', note: 'Hardware unavailable; using CPU.' });
            await this.convert(file, temporary, options, 'libx264');
          }
          if (this.cancelled) throw new Error('Cancelled');
          const stat = await fs.stat(temporary);
          if (!stat.size) throw new Error('The encoder produced an empty file.');
          await fs.rename(temporary, target);
          this.onEvent({ id: file.id, status: 'done', progress: 100, outputSize: stat.size });
        } catch (error) {
          this.onEvent({ id: file.id, status: this.cancelled ? 'cancelled' : 'error', error: this.cancelled ? 'Cancelled' : error.message });
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
      }
    } finally {
      this.running = false; this.child = null;
      this.onEvent({ type: 'finished', cancelled: this.cancelled, outputRoot });
    }
  }
  convert(file, target, options, encoder) {
    return new Promise((resolve, reject) => {
      if (this.cancelled) return reject(new Error('Cancelled'));
      const child = spawn(this.binary, ['-hide_banner', '-nostdin', '-y', '-i', file.path, ...this.encodingArgs(options, encoder), '-progress', 'pipe:1', target], { windowsHide: true });
      this.child = child;
      let stderr = '', progressBuffer = '', duration = 0;
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-12000);
        const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (match) duration = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      });
      child.stdout.on('data', chunk => {
        progressBuffer += chunk.toString();
        const lines = progressBuffer.split('\n'); progressBuffer = lines.pop();
        for (const line of lines) if (line.startsWith('out_time_us=') && duration) {
          const seconds = Number(line.split('=')[1]) / 1e6;
          if (Number.isFinite(seconds)) this.onEvent({ id: file.id, progress: Math.max(0, Math.min(99, seconds / duration * 100)) });
        }
      });
      child.on('error', reject);
      child.on('close', code => {
        this.child = null;
        if (code === 0) resolve();
        else reject(new Error(stderr.split('\n').filter(Boolean).slice(-4).join(' ').slice(-600) || 'Could not read or convert this video.'));
      });
    });
  }
}
module.exports = { BatchEngine, scanFolder };
