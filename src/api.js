async function request(url, options = {}, fetchImpl = fetch) {
  const started = performance.now()
  const response = await fetchImpl(url, options)
  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || `Request failed (${response.status})`)
  }
  return { data, durationMs: Math.round(performance.now() - started) }
}

export function cleanFilters(filters = {}) {
  return Object.fromEntries(Object.entries(filters).flatMap(([key, value]) => {
    if (typeof value === 'string') {
      const cleaned = value.trim()
      return cleaned ? [[key, cleaned]] : []
    }
    if (Array.isArray(value)) {
      const cleaned = [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))]
      return cleaned.length ? [[key, cleaned]] : []
    }
    return []
  }))
}

export function checkReadiness(signal, fetchImpl = fetch) {
  return request('/ready', { signal }, fetchImpl)
}

export function searchText({ query, mode, topK, filters, signal, fetchImpl = fetch }) {
  return request('/api/v1/search/text', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: (query || '').trim(), mode, top_k: topK, filters: cleanFilters(filters) }),
    signal,
  }, fetchImpl)
}

export function searchImage({ file, topK, filters, signal, fetchImpl = fetch }) {
  const params = new URLSearchParams({ top_k: String(topK) })
  for (const [key, value] of Object.entries(cleanFilters(filters))) {
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item)
  }
  const body = new FormData()
  body.set('image', file)
  return request(`/api/v1/search/image?${params}`, { method: 'POST', body, signal }, fetchImpl)
}

export function askProduct({ question, productId, sources = ['product'], signal, fetchImpl = fetch }) {
  return request('/api/v1/rag/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: question.trim(), product_id: productId, sources }),
    signal,
  }, fetchImpl)
}

export function getFilterOptions({ field, prefix = '', limit = 20, signal, fetchImpl = fetch }) {
  const params = new URLSearchParams({ field, prefix: prefix.trim(), limit: String(limit) })
  return request(`/api/v1/search/filter-options?${params}`, { signal }, fetchImpl)
}

export function resolveImageUrl(imageUrl) {
  if (typeof imageUrl !== 'string') return null
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl
  if (/^\/media\/products\/[^/].*/.test(imageUrl) && !imageUrl.includes('..')) return imageUrl
  const prefix = 'data/raw/images/'
  if (!imageUrl.startsWith(prefix)) return null
  const relativePath = imageUrl.slice(prefix.length)
  return relativePath ? `/media/products/${relativePath.split('/').map(encodeURIComponent).join('/')}` : null
}
