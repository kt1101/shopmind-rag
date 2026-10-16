export const SEARCH_MODES = {
  hybrid: 'Hybrid',
  bm25: 'BM25',
  dense: 'Dense text',
  cross_modal: 'Cross-modal',
}

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

export function parseFilters(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '')
  return {
    category: normalizeValues(p.getAll('category')),
    brand: normalizeValues(p.getAll('brand')),
  }
}

export function parseSearch(params) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params || '')
  const filters = parseFilters(p)
  const rawMode = p.get('mode')
  const mode = rawMode && Object.prototype.hasOwnProperty.call(SEARCH_MODES, rawMode) ? rawMode : 'hybrid'

  if (p.get('type') === 'image') {
    return {
      type: 'image',
      query: '',
      mode,
      filters,
    }
  }

  const rawQuery = (p.get('q') || '').trim()
  if (rawQuery.length > 0) {
    return {
      type: 'text',
      query: rawQuery,
      mode,
      filters,
    }
  }

  return {
    type: null,
    query: '',
    mode,
    filters,
  }
}

export function buildCatalogUrl(filters = {}) {
  const params = new URLSearchParams()
  const categories = normalizeValues(filters?.category)
  const brands = normalizeValues(filters?.brand)

  for (const cat of categories) {
    params.append('category', cat)
  }
  for (const b of brands) {
    params.append('brand', b)
  }

  const qs = params.toString()
  return qs ? `/?${qs}` : '/'
}

export function buildSearchUrl({ type, query, mode, filters } = {}) {
  const params = new URLSearchParams()

  if (type === 'image') {
    params.append('type', 'image')
  } else {
    const trimmedQuery = typeof query === 'string' ? query.trim() : ''
    const validMode = mode && Object.prototype.hasOwnProperty.call(SEARCH_MODES, mode) ? mode : 'hybrid'
    params.append('q', trimmedQuery)
    params.append('mode', validMode)
  }

  const categories = normalizeValues(filters?.category)
  const brands = normalizeValues(filters?.brand)

  for (const cat of categories) {
    params.append('category', cat)
  }
  for (const b of brands) {
    params.append('brand', b)
  }

  const qs = params.toString()
  return qs ? `/search?${qs}` : '/search'
}

export function productPath(productId) {
  return `/products/${encodeURIComponent(String(productId ?? ''))}`
}
