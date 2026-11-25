// Sends a visitor to the newest desktop installer. The repository is private, so GitHub's public
// "releases/latest/download" links answer 404 for anyone not signed in. This asks GitHub for a
// short-lived, signed link to the file and redirects to it; the installer itself never passes
// through this function.
//
// Needs GITHUB_RELEASES_TOKEN: a fine-grained token with read-only "Contents" access to this
// repository (set as a Vercel environment variable). Without it, public repositories still work.
const REPOSITORY = process.env.GITHUB_RELEASES_REPO || 'mhridoy/video_resizer';
export const INSTALLERS = {
  windows: 'Video-Resizer-Windows-Setup.exe',
  'windows-portable': 'Video-Resizer-Windows-Portable.exe',
  'mac-arm64': 'Video-Resizer-Mac-arm64.dmg',
  'mac-x64': 'Video-Resizer-Mac-x64.dmg',
};

const page = (res, status, message) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Download</title><body style="font:16px system-ui;max-width:560px;margin:15vh auto;padding:0 16px"><h1 style="font-size:20px">Download not available</h1><p>${message}</p><p><a href="/">Use the web app instead</a></p></body>`);
};

export default async function handler(req, res) {
  const name = INSTALLERS[new URL(req.url, 'http://local').searchParams.get('file') || 'windows'];
  if (!name) return page(res, 404, 'Unknown download.');
  const token = process.env.GITHUB_RELEASES_TOKEN;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'binary-beat-download', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  try {
    const latest = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers });
    if (latest.status === 404) return page(res, 503, token ? 'No release has been published yet, or the download token cannot read the repository.' : 'Downloads are not set up yet: the site owner needs to add a GitHub download token.');
    if (!latest.ok) return page(res, 502, 'GitHub did not answer. Try again in a minute.');
    const release = await latest.json();
    const asset = release.assets?.find(item => item.name === name);
    if (!asset) return page(res, 404, `This version (${release.tag_name}) has no ${name}. It is added by the next build.`);
    // GitHub answers the asset request with a redirect to a signed, short-lived storage URL.
    const file = await fetch(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'manual' });
    const location = file.headers.get('location');
    if (!location) return page(res, 502, 'GitHub did not provide a download link. Try again in a minute.');
    res.statusCode = 302;
    res.setHeader('Location', location);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  } catch {
    page(res, 502, 'GitHub could not be reached. Try again in a minute.');
  }
}
