import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceFolder } from '../electron/source-folder.cjs';
import { replaceFolder } from '../shared/replace-folder.mjs';

const output = (name, text) => ({ name, data: new TextEncoder().encode(text) });
async function fixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'binary-beat-replace-test-'));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
test('replaces originals, removes excluded media, preserves unrelated files, and leaves no CSV or staging folder', () => fixture(async root => {
  await fs.mkdir(path.join(root, 'loading'));
  await fs.writeFile(path.join(root, 'loading', 'first.jpg'), 'first');
  await fs.writeFile(path.join(root, 'loading', 'duplicate.jpg'), 'duplicate');
  await fs.writeFile(path.join(root, 'clip.mp4'), 'video');
  await fs.writeFile(path.join(root, '_chat.txt'), 'chat');
  await fs.writeFile(path.join(root, '.keep'), 'system');
  const folder = new SourceFolder(), selected = await folder.open(root);
  await fs.writeFile(path.join(root, 'added-after-import.txt'), 'unrelated');
  await folder.replace(selected.token, [output('C_LOADING_75PCT_01.jpg', 'compressed'), output('C_VIDEO_01.mp4', 'video')]);
  assert.deepEqual((await fs.readdir(root)).sort(), ['.keep','C_LOADING_75PCT_01.jpg','C_VIDEO_01.mp4','added-after-import.txt']);
  assert.equal(await fs.readFile(path.join(root, 'C_LOADING_75PCT_01.jpg'),'utf8'), 'compressed');
}));
test('supports replacing a file under its original name', () => fixture(async root => {
  await fs.writeFile(path.join(root, 'photo.jpg'), 'original');
  const folder = new SourceFolder(), selected = await folder.open(root);
  await folder.replace(selected.token, [output('photo.jpg','new')]);
  assert.deepEqual(await fs.readdir(root), ['photo.jpg']);
  assert.equal(await fs.readFile(path.join(root,'photo.jpg'),'utf8'),'new');
}));
test('changed originals and new output collisions stop replacement without deleting originals', () => fixture(async root => {
  const original = path.join(root, 'photo.jpg'); await fs.writeFile(original,'original');
  const folder = new SourceFolder(); let selected = await folder.open(root);
  await fs.writeFile(original,'edited original');
  await assert.rejects(folder.replace(selected.token,[output('new.jpg','new')]), /changed since import/);
  assert.equal(await fs.readFile(original,'utf8'),'edited original');
  selected = await folder.open(root); await fs.writeFile(path.join(root,'new.jpg'),'unrelated');
  await assert.rejects(folder.replace(selected.token,[output('new.jpg','new')]), /unrelated/);
  assert.equal(await fs.readFile(path.join(root,'new.jpg'),'utf8'),'unrelated');
  await assert.rejects(folder.replace(selected.token,[output('../outside.jpg','bad')]), /Invalid/);
}));

function memoryIO(fail) {
  const files = new Map([['original.jpg','original'],['duplicate.jpg','duplicate']]);
  let injected = false;
  const checkFailure = (operation, destination) => { if (!injected && fail(operation,destination)) { injected = true; throw Error('Injected storage failure'); } };
  return { files,
    async listRoot() { return [...files.keys()].filter(p=>!p.includes('/')).map(name=>({name,kind:'file'})); },
    async verify(original) { if (!files.has(original.path)) throw Error('Missing original'); },
    async mkdir() {},
    async write(to,data) { checkFailure('write',to); files.set(to,data); },
    async copy(from,to) { checkFailure('copy',to); if(files.has(to)) throw Error('Existing target'); if(!files.has(from)) throw Error('Missing backup'); files.set(to,files.get(from)); },
    async remove(name) { checkFailure('remove',name); files.delete(name); },
    async removeTree(name) { for(const key of files.keys()) if(key.startsWith(name+'/')) files.delete(key); },
  };
}
for (const phase of ['staging','install','delete']) test(`restores original contents after ${phase} failure`, async () => {
  const io = memoryIO((op,to) => phase === 'staging' ? op==='write' && to.includes('/prepared/') : phase==='install' ? op==='copy' && to==='two.jpg' : op==='remove' && to==='duplicate.jpg');
  await assert.rejects(replaceFolder(io, [{path:'original.jpg'},{path:'duplicate.jpg'}], [output('one.jpg','one'),output('two.jpg','two')]), /Original files were (restored|not changed)/);
  assert.deepEqual(Object.fromEntries(io.files), {'original.jpg':'original','duplicate.jpg':'duplicate'});
});

test('preserves recovery copies if restoring originals fails', async () => {
  const io = memoryIO(() => false), copy = io.copy;
  io.copy = async (from,to) => {
    if (to === 'new.jpg' || (from.includes('/originals/') && to === 'original.jpg')) throw Error('Disk unavailable');
    return copy(from,to);
  };
  await assert.rejects(replaceFolder(io,[{path:'original.jpg'},{path:'duplicate.jpg'}],[output('new.jpg','new')]), /backups are in/);
  assert.ok([...io.files.keys()].some(key => key.endsWith('/originals/original.jpg')));
  assert.equal(io.files.get('duplicate.jpg'),'duplicate');
});
test('cleanup failure preserves installed outputs and reports remaining recovery data', async () => {
  const io = memoryIO(() => false);
  io.removeTree = async () => { throw Error('Cleanup denied'); };
  const result = await replaceFolder(io,[{path:'original.jpg'},{path:'duplicate.jpg'}],[output('new.jpg','new')]);
  assert.ok(io.files.has('new.jpg'));
  assert.equal(io.files.has('original.jpg'),false);
  assert.match(result.cleanupWarning,/temporary recovery data remains/);
});
