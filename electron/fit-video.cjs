const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const fitModule = import('../shared/fit-size.mjs');

// Re-encodes one video natively until it is below the target size. Used by "Fit to size" on desktop.
class FitVideo {
  constructor(binary) { this.binary = binary; this.child = null; this.cancelled = false; }
  cancel() { this.cancelled = true; this.child?.kill(); }
  run(args, onLine) {
    return new Promise((resolve, reject) => {
      if (this.cancelled) return reject(new Error('Cancelled'));
      const child = spawn(this.binary, args, { windowsHide: true });
      this.child = child;
      let stderr = '', buffer = '';
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-12000); });
      child.stdout.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n'); buffer = lines.pop();
        lines.forEach(line => onLine?.(line));
      });
      child.on('error', reject);
      child.on('close', code => { this.child = null; resolve({ code, stderr }); });
    });
  }
  async duration(input) {
    const { stderr } = await this.run(['-hide_banner', '-nostdin', '-i', input]);
    const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  }
  async fit(input, targetBytes, { mute = false } = {}, onProgress = () => {}) {
    const { isVideo } = await import('../shared/options.mjs');
    const { videoPlan, videoArgs } = await fitModule;
    if (!path.isAbsolute(input) || !isVideo(input) || !(await fs.stat(input)).isFile()) throw new Error('Choose a video file.');
    this.cancelled = false;
    const duration = await this.duration(input);
    if (!duration) throw new Error('Could not read the video duration.');
    const target = path.join(os.tmpdir(), `binary-beat-fit-${randomUUID()}.mp4`);
    let encoder = process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264';
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const plan = videoPlan(duration, targetBytes, attempt, { mute });
        const onLine = line => {
          if (!line.startsWith('out_time_us=')) return;
          const seconds = Number(line.split('=')[1]) / 1e6;
          if (Number.isFinite(seconds)) onProgress(Math.min(99, (attempt + seconds / duration) / (attempt + 1) * 100), attempt);
        };
        const encode = () => this.run(['-hide_banner', '-nostdin', '-y', '-i', input, ...videoArgs(plan, encoder), '-progress', 'pipe:1', target], onLine);
        let result = await encode();
        if (this.cancelled) throw new Error('Cancelled');
        if (result.code !== 0 && encoder !== 'libx264') {
          encoder = 'libx264';
          result = await encode();
          if (this.cancelled) throw new Error('Cancelled');
        }
        if (result.code !== 0) throw new Error(result.stderr.split('\n').filter(Boolean).slice(-3).join(' ').slice(-500) || 'Could not convert this video.');
        let { size } = await fs.stat(target);
        // VideoToolbox does not hold its bitrate on detailed footage; libx264 does, so retry this budget on the CPU.
        if (size > targetBytes && encoder !== 'libx264') {
          encoder = 'libx264';
          result = await encode();
          if (this.cancelled) throw new Error('Cancelled');
          if (result.code !== 0) throw new Error(result.stderr.split('\n').filter(Boolean).slice(-3).join(' ').slice(-500) || 'Could not convert this video.');
          ({ size } = await fs.stat(target));
        }
        if (size && size <= targetBytes) return { data: await fs.readFile(target), width: plan.maxEdge, attempt };
      }
      throw new Error('Could not get this video under the size limit.');
    } finally { await fs.rm(target, { force: true }).catch(() => {}); }
  }
}
module.exports = { FitVideo };
