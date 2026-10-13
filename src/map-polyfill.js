// pdf.js 6 uses Map.prototype.getOrInsertComputed, which older Chrome, Safari and Electron builds lack.
for (const Type of [Map, WeakMap]) {
  if (!Type.prototype.getOrInsert) Object.defineProperty(Type.prototype, 'getOrInsert', { configurable: true, writable: true, value(key, value) { if (!this.has(key)) this.set(key, value); return this.get(key); } });
  if (!Type.prototype.getOrInsertComputed) Object.defineProperty(Type.prototype, 'getOrInsertComputed', { configurable: true, writable: true, value(key, compute) { if (!this.has(key)) this.set(key, compute(key)); return this.get(key); } });
}
