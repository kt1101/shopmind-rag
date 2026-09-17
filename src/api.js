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

function cleanFilters(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, value.trim()]),
  )
}

export function checkReadiness(signal, fetchImpl = fetch) {
  return request('/ready', { signal }, fetchImpl)
}

export function searchText({ query, mode, topK, filters, signal, fetchImpl = fetch }) {
  return request('/api/v1/search/text', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: query.trim(), mode, top_k: topK, filters: cleanFilters(filters) }),
    signal,
  }, fetchImpl)
}

export function searchImage({ file, topK, filters, signal, fetchImpl = fetch }) {
  const params = new URLSearchParams({ top_k: String(topK) })
  for (const [key, value] of Object.entries(cleanFilters(filters))) params.set(key, value)
  const body = new FormData()
  body.set('image', file)
  return request(`/api/v1/search/image?${params}`, { method: 'POST', body, signal }, fetchImpl)
}

export function resolveImageUrl(imageUrl) {
  if (typeof imageUrl !== 'string') return null
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl
  const prefix = 'data/raw/images/'
  if (!imageUrl.startsWith(prefix)) return null
  const relativePath = imageUrl.slice(prefix.length)
  return relativePath ? `/media/products/${relativePath.split('/').map(encodeURIComponent).join('/')}` : null
}
