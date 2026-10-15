const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const policy = import('../shared/replace-folder.mjs');

class SourceFolder {
  constructor() { this.entries = new Map(); this.running = false; }
  async open(root) {
    if (this.running) throw new Error('Folder replacement is running.');
    const { RECOVERY_PREFIX } = await policy;
    const { fileKind } = await import('../shared/fit-size.mjs');
    if (!(await fs.lstat(root)).isDirectory()) throw new Error('Choose a real folder, not a shortcut.');
    root = await fs.realpath(root);
    const entries = new Map();
    async function walk(dir, prefix = '') {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(RECOVERY_PREFIX)) throw new Error(`An interrupted replacement needs recovery: ${entry.name}. Restore its originals first.`);
        if (entry.name.startsWith('.') || fileKind(entry.name) === 'skip' || entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name, target = path.join(dir, entry.name);
        if (entry.isDirectory()) { await walk(target, relative + '/'); continue; }
        if (!entry.isFile()) continue;
        const stat = await fs.lstat(target);
        if (!stat.size) continue;
        entries.set(randomUUID(), { path: relative, size: stat.size, lastModified: stat.mtimeMs, ino: stat.ino, dev: stat.dev });
      }
    }
    await walk(root);
    this.root = root; this.entries = entries; this.token = randomUUID();
    this.rootStat = await fs.lstat(root);
    return { token: this.token, name: path.basename(root), files: [...entries].map(([id, value]) => ({ id, path: value.path, size: value.size, lastModified: value.lastModified })) };
  }
  async resolve(relative, createParents = false) {
    const { checkedPath } = await policy;
    checkedPath(relative);
    const rootStat = await fs.lstat(this.root);
    if (!rootStat.isDirectory() || rootStat.ino !== this.rootStat.ino || rootStat.dev !== this.rootStat.dev) throw new Error('The selected folder changed.');
    const parts = relative.split('/'), name = parts.pop();
    let directory = this.root;
    for (const part of parts) {
      directory = path.join(directory, part);
      if (createParents) try { await fs.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      if (!(await fs.lstat(directory)).isDirectory()) throw new Error('A source folder was replaced by a link or file.');
    }
    const target = path.join(directory, name);
    try { if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Symbolic links cannot be replaced.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return target;
  }
  async verify(original) {
    const stat = await fs.lstat(await this.resolve(original.path));
    if (!stat.isFile() || stat.size !== original.size || stat.mtimeMs !== original.lastModified || stat.ino !== original.ino || stat.dev !== original.dev) throw new Error(`File changed since import: ${original.path}`);
  }
  async read(token, id) {
    if (this.running || token !== this.token || !this.entries.has(id)) throw new Error('Unknown source file.');
    const original = this.entries.get(id);
    if (original.size > 1024 ** 3) throw new Error('Folder files above 1 GB are not supported in this workflow.');
    await this.verify(original);
    const result = await fs.readFile(await this.resolve(original.path));
    await this.verify(original);
    return new Uint8Array(result);
  }
  async replace(token, outputs) {
    if (this.running || !this.root || token !== this.token) throw new Error('Choose the source folder again.');
    if (!Array.isArray(outputs) || !outputs.length || outputs.some(o => !o || typeof o.name !== 'string' || !(o.data instanceof Uint8Array) || !o.data.length)) throw new Error('Invalid prepared files.');
    this.running = true;
    try {
      const { replaceFolder, checkedPath, RECOVERY_PREFIX } = await policy;
      const io = {
        listRoot: async () => (await fs.readdir(this.root, { withFileTypes: true })).map(e => ({ name: e.name, kind: e.isFile() ? 'file' : 'directory' })),
        verify: original => this.verify(original),
        mkdir: async relative => { await fs.mkdir(await this.resolve(relative)); },
        write: async (relative, data) => {
          const target = await this.resolve(relative, true), file = await fs.open(target, 'wx', 0o600);
          try { await file.writeFile(data); await file.sync(); }
          catch (error) { await file.close(); await fs.unlink(target).catch(() => {}); throw error; }
          await file.close();
        },
        copy: async (from, to) => {
          const source = await this.resolve(from), target = await this.resolve(to, true);
          await fs.copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        },
        remove: async relative => { await fs.unlink(await this.resolve(relative)); },
        removeEmptyDirectory: async relative => { await fs.rmdir(await this.resolve(relative)); },
        removeTree: async relative => {
          checkedPath(relative, true);
          if (!relative.startsWith(RECOVERY_PREFIX)) throw new Error('Invalid cleanup directory.');
          await fs.rm(await this.resolve(relative), { recursive: true });
        },
      };
      const result = await replaceFolder(io, [...this.entries.values()], outputs);
      this.token = undefined; this.entries.clear();
      return result;
    } finally { this.running = false; }
  }
}
module.exports = { SourceFolder };
