// Storefront search URLs never carry an algorithm: the backend runs the admin-configured
// default pipeline (config `defaults.search`, docs/API_CONTRACT.md "Storefront vs. staff").
// Old links with `?mode=` still work, the parameter is simply ignored.

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
  const rawQuery = (p.get('q') || '').trim()

  if (p.get('type') === 'image') {
    return { type: 'image', query: '', filters }
  }

  // F1: image + text. Without text it degrades to an image search.
  if (p.get('type') === 'compose') {
    return rawQuery
      ? { type: 'compose', query: rawQuery, filters, alpha: parseAlpha(p.get('alpha')) }
      : { type: 'image', query: '', filters }
  }

  if (rawQuery.length > 0) {
    return { type: 'text', query: rawQuery, filters }
  }

  return { type: null, query: '', filters }
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

export function buildSearchUrl({ type, query, filters, alpha } = {}) {
  const params = new URLSearchParams()
  const trimmedQuery = typeof query === 'string' ? query.trim() : ''

  if (type === 'image') {
    params.append('type', 'image')
  } else if (type === 'compose') {
    params.append('type', 'compose')
    params.append('q', trimmedQuery)
    params.append('alpha', String(parseAlpha(alpha)))
  } else {
    params.append('q', trimmedQuery)
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
