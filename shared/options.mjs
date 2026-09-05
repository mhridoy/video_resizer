const EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mts', 'm2ts', 'wmv', 'flv', 'mpg', 'mpeg', '3gp', 'ts']);
const PROFILES = {
  balanced: { crf: 24, preset: 'veryfast', audio: '128k' },
  smaller: { crf: 29, preset: 'fast', audio: '96k' },
  quality: { crf: 20, preset: 'fast', audio: '160k' },
};
function validateOptions(options = {}) {
  const { profile = 'balanced', resolution = '1080', hardware = true } = options;
  if (!Object.hasOwn(PROFILES, profile) || !['original', '1080', '720', '480'].includes(String(resolution))) throw new Error('Invalid conversion settings.');
  return { profile, resolution: String(resolution), hardware: hardware === true };
}
function encodingArgs(options, encoder = 'libx264') {
  const { profile, resolution } = validateOptions(options);
  const p = PROFILES[profile];
  const bound = resolution === 'original' ? 32768 : Number(resolution) * 16 / 9;
  // A longest-edge cap works for landscape and portrait. Even dimensions are required for yuv420p.
  const filter = `scale=w='max(2,trunc(iw*sar*min(1,${bound}/max(iw*sar,ih))/2)*2)':h='max(2,trunc(ih*min(1,${bound}/max(iw*sar,ih))/2)*2)',setsar=1`;
  const codec = encoder === 'h264_nvenc' ? ['-c:v', encoder, '-preset', 'p4', '-rc', 'vbr', '-cq', String(p.crf), '-b:v', '0']
    : encoder === 'h264_videotoolbox' ? ['-c:v', encoder, '-q:v', String(100 - p.crf * 2), '-allow_sw', '0']
    : ['-c:v', 'libx264', '-preset', p.preset, '-crf', String(p.crf)];
  return ['-map', '0:v:0', '-map', '0:a:0?', '-vf', filter, ...codec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', p.audio, '-movflags', '+faststart', '-sn', '-dn'];
}
function isVideo(name) { return EXTENSIONS.has(name.split('.').pop().toLowerCase()); }
export { encodingArgs, validateOptions, isVideo };
