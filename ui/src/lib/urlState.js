export const SEARCH_MODES = {
  hybrid: 'Hybrid',
  bm25: 'BM25',
  dense: 'Dense text',
  cross_modal: 'Cross-modal',
}

export const DEFAULT_ALPHA = 0.6
// URL filter fields. `color` exists only on search (the catalog listing has no colour filter).
export const FILTER_FIELDS = ['category', 'brand', 'color']

function normalizeValues(values) {
  if (!values || !Array.isArray(values)) return []
  const seen = new Set()
  const result = []
  for (const item of values) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed)
      result.push(trimmed)
    }
  }
  return result
}

export function parseAlpha(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_ALPHA
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_ALPHA
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100
}

export function parseFilters(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '')
  return {
    category: normalizeValues(p.getAll('category')),
    brand: normalizeValues(p.getAll('brand')),
    color: normalizeValues(p.getAll('color')),
  }
}

export function parseSearch(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '')
  const filters = parseFilters(p)
  const rawMode = p.get('mode')
  const mode = rawMode && Object.prototype.hasOwnProperty.call(SEARCH_MODES, rawMode) ? rawMode : 'hybrid'
  const rawQuery = (p.get('q') || '').trim()

  if (p.get('type') === 'image') {
    return { type: 'image', query: '', mode, filters }
  }

  // F1: image + text. Without text it degrades to an image search.
  if (p.get('type') === 'compose') {
    return rawQuery
      ? { type: 'compose', query: rawQuery, mode, filters, alpha: parseAlpha(p.get('alpha')) }
      : { type: 'image', query: '', mode, filters }
  }

  if (rawQuery.length > 0) {
    return { type: 'text', query: rawQuery, mode, filters }
  }

  return { type: null, query: '', mode, filters }
}

function appendFilters(params, filters, fields) {
  for (const field of fields) {
    for (const value of normalizeValues(filters?.[field])) params.append(field, value)
  }
}

export function buildCatalogUrl(filters = {}) {
  const params = new URLSearchParams()
  appendFilters(params, filters, ['category', 'brand'])
  const qs = params.toString()
  return qs ? `/?${qs}` : '/'
}

export function buildSearchUrl({ type, query, mode, filters, alpha } = {}) {
  const params = new URLSearchParams()
  const trimmedQuery = typeof query === 'string' ? query.trim() : ''

  if (type === 'image') {
    params.append('type', 'image')
  } else if (type === 'compose') {
    params.append('type', 'compose')
    params.append('q', trimmedQuery)
    params.append('alpha', String(parseAlpha(alpha)))
  } else {
    const validMode = mode && Object.prototype.hasOwnProperty.call(SEARCH_MODES, mode) ? mode : 'hybrid'
    params.append('q', trimmedQuery)
    params.append('mode', validMode)
  }

  appendFilters(params, filters, FILTER_FIELDS)
  const qs = params.toString()
  return qs ? `/search?${qs}` : '/search'
}

export function productPath(productId) {
  return `/products/${encodeURIComponent(String(productId ?? ''))}`
}

export function hasActiveFilters(filters = {}) {
  return FILTER_FIELDS.some((field) => (filters[field] || []).length > 0)
}
