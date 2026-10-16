import {mkdir, readdir, copyFile} from 'node:fs/promises';
await mkdir('public/ml',{recursive:true});
for(const name of await readdir('node_modules/onnxruntime-web/dist')) {
  if (/^ort-wasm.*\.(wasm|mjs)$/.test(name)) await copyFile(`node_modules/onnxruntime-web/dist/${name}`,`public/ml/${name}`);
}
