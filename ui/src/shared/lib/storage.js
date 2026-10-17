// localStorage helpers that never throw (private mode, blocked storage, quota, SSR/tests).

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readJSON(key, fallback, storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function writeJSON(key, value, storage = defaultStorage()) {
  try {
    storage?.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeKey(key, storage = defaultStorage()) {
  try {
    storage?.removeItem(key)
  } catch {
    // ignore
  }
}

export function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  }
}
