import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/download.js';

const call = async (url, responses) => {
  const realFetch = globalThis.fetch, seen = [];
  globalThis.fetch = async (target, options) => { seen.push({ target, options }); return responses.shift(); };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
  try { await handler({ url }, res); } finally { globalThis.fetch = realFetch; }
  return { res, seen };
};
const json = (status, value) => ({ ok: status < 300, status, json: async () => value, headers: new Headers() });

test('redirects to a signed link for the private release asset, using the token', async () => {
  process.env.GITHUB_RELEASES_TOKEN = 'test-token';
  const { res, seen } = await call('/api/download?file=mac-arm64', [
    json(200, { tag_name: 'v1', assets: [{ name: 'Video-Resizer-Mac-arm64.dmg', url: 'https://api.github.com/assets/1' }] }),
    { status: 302, headers: new Headers({ location: 'https://objects.example/signed' }) },
  ]);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, 'https://objects.example/signed');
  assert.equal(seen[0].options.headers.Authorization, 'Bearer test-token');
  assert.equal(seen[1].options.headers.Accept, 'application/octet-stream');
  delete process.env.GITHUB_RELEASES_TOKEN;
});

test('explains a missing token or file instead of a bare 404', async () => {
  const missing = await call('/api/download?file=windows', [json(404, {})]);
  assert.equal(missing.res.statusCode, 503);
  assert.match(missing.res.body, /download token/);
  const absent = await call('/api/download?file=mac-x64', [json(200, { tag_name: 'v1', assets: [] })]);
  assert.equal(absent.res.statusCode, 404);
  assert.match(absent.res.body, /next build/);
});
