// Maps the parsed URL search (lib/urlState parseSearch) + the attached image to one API call.
// Text searches send no `mode` / `pipeline`: the backend runs the admin-configured default.

export const RESULT_LIMIT = 20

export function buildSearchCall(search, imageFile, { explain = false, topK = RESULT_LIMIT } = {}) {
  if (!search?.type) return null
  if (search.type === 'text') {
    return { kind: 'text', args: { query: search.query, topK, filters: search.filters, explain } }
  }
  if (!imageFile) return null
  if (search.type === 'compose') {
    return { kind: 'compose', args: { file: imageFile, text: search.query, alpha: search.alpha, topK, explain } }
  }
  return { kind: 'image', args: { file: imageFile, topK, filters: search.filters, explain } }
}

// Understood filters (search response `understood` or POST /search/understand) that are not
// applied yet, as [{field, values}] for the "Hệ thống hiểu" banner.
export function pendingUnderstood(understood, filters = {}) {
  const out = []
  for (const field of ['category', 'brand', 'color']) {
    const values = Array.isArray(understood?.filters?.[field]) ? understood.filters[field] : understood?.filters?.[field] ? [understood.filters[field]] : []
    const missing = values.filter((v) => typeof v === 'string' && v && !(filters[field] || []).includes(v))
    if (missing.length) out.push({ field, values: missing })
  }
  return out
}

export function applyUnderstood(filters = {}, pending = []) {
  const next = { category: [...(filters.category || [])], brand: [...(filters.brand || [])], color: [...(filters.color || [])] }
  for (const { field, values } of pending) next[field] = [...new Set([...next[field], ...values])]
  return next
}
