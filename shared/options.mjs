const EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ts']);
const PROFILES = {
  fast: { crf: 24, preset: 'ultrafast', audio: '128k' },
  balanced: { crf: 24, preset: 'veryfast', audio: '128k' },
  smaller: { crf: 29, preset: 'fast', audio: '96k' },
  quality: { crf: 20, preset: 'fast', audio: '160k' },
};
function validateOptions(options = {}) {
  const { profile = 'balanced', resolution = '1080', hardware = true, trimStart = 0, trimEnd, mute = false } = options;
  if (!Object.hasOwn(PROFILES, profile) || !['original', '1080', '720', '480'].includes(String(resolution))) throw new Error('Invalid conversion settings.');
  if (!Number.isFinite(trimStart) || trimStart < 0) throw new Error('Trim start must be a nonnegative number of seconds.');
  if (trimEnd !== undefined && (!Number.isFinite(trimEnd) || trimEnd <= trimStart)) throw new Error('Trim end must be later than trim start.');
  if (typeof mute !== 'boolean') throw new Error('Mute must be enabled or disabled.');
  return { profile, resolution: String(resolution), hardware: hardware === true, trimStart, trimEnd, mute };
}
// Seeking before input decoding avoids processing the discarded beginning of a video.
function inputArgs(options) {
  const { trimStart } = validateOptions(options);
  return trimStart > 0 ? ['-ss', String(trimStart)] : [];
}
function encodingArgs(options, encoder = 'libx264') {
  const { profile, resolution, trimStart, trimEnd, mute } = validateOptions(options);
  const p = PROFILES[profile];
  const bound = resolution === 'original' ? 32768 : Number(resolution) * 16 / 9;
  // A longest-edge cap works for landscape and portrait. Even dimensions are required for yuv420p.
  const filter = `scale=w='max(2,trunc(iw*sar*min(1,${bound}/max(iw*sar,ih))/2)*2)':h='max(2,trunc(ih*min(1,${bound}/max(iw*sar,ih))/2)*2)',setsar=1`;
  const codec = encoder === 'h264_nvenc' ? ['-c:v', encoder, '-preset', profile === 'fast' ? 'p1' : 'p4', '-rc', 'vbr', '-cq', String(p.crf), '-b:v', '0']
    : encoder === 'h264_videotoolbox' ? ['-c:v', encoder, '-q:v', String(100 - p.crf * 2), '-allow_sw', '0']
    : ['-c:v', 'libx264', '-preset', p.preset, '-crf', String(p.crf)];
  const audioMap = mute ? [] : ['-map', '0:a:0?'];
  const audioCodec = mute ? ['-an'] : ['-c:a', 'aac', '-b:a', p.audio];
  const trim = trimEnd === undefined ? [] : ['-t', String(trimEnd - trimStart)];
  return ['-map', '0:v:0', ...audioMap, '-vf', filter, ...codec, '-pix_fmt', 'yuv420p', ...audioCodec, ...trim, '-movflags', '+faststart', '-sn', '-dn'];
}
function isVideo(name) { return EXTENSIONS.has(name.split('.').pop().toLowerCase()); }
export { inputArgs, encodingArgs, validateOptions, isVideo };
