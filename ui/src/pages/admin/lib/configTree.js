// Pure helpers for the Pipeline & Config page: flatten/unflatten the effective config,
// diff a draft against the active values, and infer an input type per hot-reloadable key.

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// {a: {b: 1}} -> {'a.b': 1}. Arrays and scalars are leaves; empty objects are kept as leaves.
export function flattenConfig(obj, prefix = '', out = {}) {
  if (!isPlainObject(obj)) {
    if (prefix) out[prefix] = obj
    return out
  }
  const keys = Object.keys(obj)
  if (keys.length === 0 && prefix) {
    out[prefix] = {}
    return out
  }
  for (const key of keys) {
    const path = prefix ? `${prefix}.${key}` : key
    const value = obj[key]
    if (isPlainObject(value) && Object.keys(value).length > 0) flattenConfig(value, path, out)
    else out[path] = value
  }
  return out
}

export function unflattenConfig(flat) {
  const root = {}
  for (const [path, value] of Object.entries(flat || {})) {
    const parts = path.split('.')
    let node = root
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!isPlainObject(node[parts[i]])) node[parts[i]] = {}
      node = node[parts[i]]
    }
    node[parts[parts.length - 1]] = value
  }
  return root
}

export function getAtPath(obj, path) {
  return path.split('.').reduce((node, key) => (isPlainObject(node) ? node[key] : undefined), obj)
}

function sameValue(a, b) {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

// Returns the changed keys only, sorted by key: [{key, from, to}].
export function diffConfig(active, draft) {
  const keys = new Set([...Object.keys(active || {}), ...Object.keys(draft || {})])
  return [...keys]
    .filter((key) => key in (draft || {}) && !sameValue(active?.[key], draft[key]))
    .sort()
    .map((key) => ({ key, from: active?.[key], to: draft[key] }))
}

export function overridesFromDiff(diff) {
  return Object.fromEntries(diff.map(({ key, to }) => [key, to]))
}

// Known enums, used when the backend only sends dotted keys. The backend may also send
// richer entries ({key, type, options, min, max}); see normalizeHotReloadable.
export const ENUM_HINTS = {
  'retrieval.default_mode': ['bm25', 'dense', 'hybrid', 'cross_modal', 'adaptive'],
  'fusion.method': ['rrf', 'concat'],
  'rag.fusion': ['rrf', 'concat'],
  'rag.retrieval_mode': ['bm25', 'dense', 'hybrid', 'adaptive'],
  'rag.default_mode': ['bm25', 'dense', 'hybrid', 'adaptive'],
}

const ENUM_SUFFIX_HINTS = [
  [/(^|\.)(default_)?mode$/, ['bm25', 'dense', 'hybrid', 'cross_modal', 'adaptive']],
  [/(^|\.)fusion(\.method)?$/, ['rrf', 'concat']],
]

export function normalizeHotReloadable(entries = []) {
  return entries
    .map((entry) => (typeof entry === 'string' ? { key: entry } : entry))
    .filter((entry) => entry && typeof entry.key === 'string')
}

// -> {type: 'number'|'integer'|'boolean'|'enum'|'string'|'json', options?, min?, max?, step?}
export function inferInputType(key, value, spec = {}) {
  if (spec.type === 'enum' || Array.isArray(spec.options)) {
    return { type: 'enum', options: spec.options || ENUM_HINTS[key] || [String(value)] }
  }
  if (spec.type === 'boolean' || typeof value === 'boolean') return { type: 'boolean' }
  if (spec.type === 'integer' || spec.type === 'number' || typeof value === 'number') {
    const integer = spec.type === 'integer' || (spec.type !== 'number' && Number.isInteger(value))
    return {
      type: integer ? 'integer' : 'number',
      min: spec.min,
      max: spec.max,
      step: integer ? 1 : spec.step ?? 'any',
    }
  }
  if (typeof value === 'string' || value == null) {
    if (ENUM_HINTS[key]) return { type: 'enum', options: ENUM_HINTS[key] }
    const suffix = ENUM_SUFFIX_HINTS.find(([pattern]) => pattern.test(key))
    if (suffix && typeof value === 'string' && suffix[1].includes(value)) return { type: 'enum', options: suffix[1] }
    return { type: 'string' }
  }
  return { type: 'json' }
}

// Turns a raw form value back into a typed config value. Returns {value} or {error}.
export function coerceInput(input, raw) {
  switch (input.type) {
    case 'boolean':
      return { value: raw === true || raw === 'true' }
    case 'integer':
    case 'number': {
      if (raw === '' || raw == null) return { error: 'Required' }
      const n = Number(raw)
      if (!Number.isFinite(n)) return { error: 'Must be a number' }
      if (input.type === 'integer' && !Number.isInteger(n)) return { error: 'Must be an integer' }
      if (input.min != null && n < input.min) return { error: `Must be ≥ ${input.min}` }
      if (input.max != null && n > input.max) return { error: `Must be ≤ ${input.max}` }
      return { value: n }
    }
    case 'enum':
      if (input.options && !input.options.includes(raw)) return { error: 'Not an allowed value' }
      return { value: raw }
    case 'json':
      try {
        return { value: typeof raw === 'string' ? JSON.parse(raw) : raw }
      } catch {
        return { error: 'Invalid JSON' }
      }
    default:
      return { value: raw == null ? '' : String(raw) }
  }
}

export function formatConfigValue(value) {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value === '' ? '""' : value
  return JSON.stringify(value)
}

// Maps a 422 error to {dotted.key: message}. Accepts `error.details: [{field|loc, message|msg}]`,
// a FastAPI-style `detail` array, or falls back to parsing "key: message" lines.
export function fieldErrorsFrom(error) {
  const out = {}
  const details = error?.details || error?.body?.error?.details || error?.body?.detail
  if (Array.isArray(details)) {
    for (const item of details) {
      const field = item.field || (Array.isArray(item.loc) ? item.loc.filter((p) => p !== 'body' && p !== 'overrides').join('.') : item.loc)
      if (field) out[field] = item.message || item.msg || 'Invalid value'
    }
  }
  if (Object.keys(out).length === 0 && typeof error?.message === 'string') {
    for (const line of error.message.split(/[\n;]/)) {
      const match = line.match(/^\s*([\w.]+)\s*:\s*(.+)$/)
      if (match && match[1].includes('.')) out[match[1]] = match[2].trim()
    }
  }
  return out
}

// Builds a tree for display: [{key, path, value?, children?}]
export function toTree(obj, prefix = '') {
  if (!isPlainObject(obj)) return []
  return Object.keys(obj).map((key) => {
    const path = prefix ? `${prefix}.${key}` : key
    const value = obj[key]
    return isPlainObject(value) ? { key, path, children: toTree(value, path) } : { key, path, value }
  })
}
