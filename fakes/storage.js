export function createFakeStorage() {
  const map = new Map();
  return {
    full: false,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (this.full) throw new Error('QuotaExceededError');
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
  };
}
