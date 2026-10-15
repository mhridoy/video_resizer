import { fileKind } from '../shared/fit-size.mjs';
import { RECOVERY_PREFIX, checkedPath, replaceFolder } from '../shared/replace-folder.mjs';

async function directoryAt(root, path, create = false) {
  let dir = root;
  for (const part of path) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}
export async function openSourceFolder(root, check = () => {}) {
  if (await root.requestPermission({ mode: 'readwrite' }) !== 'granted') throw Error('Folder write access is needed to replace files.');
  const originals = [], files = [];
  async function walk(dir, prefix = '') {
    for await (const [name, handle] of dir.entries()) {
      check();
      if (name.startsWith(RECOVERY_PREFIX)) throw Error(`An interrupted replacement needs recovery: ${name}. Restore its originals first.`);
      if (name.startsWith('.') || fileKind(name) === 'skip') continue;
      const path = prefix + name;
      if (handle.kind === 'directory') { await walk(handle, path + '/'); continue; }
      const file = await handle.getFile();
      if (!file.size) continue;
      originals.push({ path, size: file.size, lastModified: file.lastModified, handle });
      file.relativeName = `${root.name}/${path}`; file.shipmentSource = root; files.push(file);
    }
  }
  await walk(root);
  return { root, name: root.name, originals, files };
}

export async function replaceSourceFolder(source, outputs, options) {
  const root = source.root;
  if (await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw Error('Folder write permission expired. Choose the folder again.');
  const locate = async (path, create = false) => {
    const parts = checkedPath(path).split('/'), name = parts.pop();
    return { dir: await directoryAt(root, parts, create), name };
  };
  const io = {
    async listRoot() { const entries = []; for await (const [name, handle] of root.entries()) entries.push({ name, kind: handle.kind }); return entries; },
    async verify(original) {
      const { dir, name } = await locate(original.path);
      const handle = await dir.getFileHandle(name), file = await handle.getFile();
      if (!(await handle.isSameEntry(original.handle)) || file.size !== original.size || file.lastModified !== original.lastModified) throw Error(`File changed since import: ${original.path}`);
    },
    async mkdir(path) { await directoryAt(root, checkedPath(path).split('/'), true); },
    async write(path, data, exclusive = true) {
      const { dir, name } = await locate(path, true);
      if (exclusive) {
        try { await dir.getFileHandle(name); throw Error(`File already exists: ${path}`); }
        catch (error) { if (error.name !== 'NotFoundError') throw error; }
      }
      const handle = await dir.getFileHandle(name, { create: true });
      let stream;
      try {
        stream = await handle.createWritable(); await stream.write(data); await stream.close();
        const size = data.size ?? data.byteLength;
        if ((await handle.getFile()).size !== size) throw Error('Written size does not match.');
      } catch (error) {
        await stream?.abort().catch(() => {});
        await dir.removeEntry(name).catch(() => {});
        throw error;
      }
    },
    async copy(from, to) {
      const { dir, name } = await locate(from);
      await io.write(to, await (await dir.getFileHandle(name)).getFile(), true);
    },
    async remove(path) { const { dir, name } = await locate(path); await dir.removeEntry(name); },
    async removeEmptyDirectory(path) { const { dir, name } = await locate(path); await dir.getDirectoryHandle(name); await dir.removeEntry(name); },
    async removeTree(path) { checkedPath(path, true); if (!path.startsWith(RECOVERY_PREFIX)) throw Error('Invalid cleanup path.'); await root.removeEntry(path, { recursive: true }); },
  };
  return replaceFolder(io, source.originals, outputs, options);
}
