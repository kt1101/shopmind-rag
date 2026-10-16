// Shared HTTP helper for every API module (storefront, inspector, admin).
// Contract: docs/API_CONTRACT.md. Errors carry `status` and `code` from the backend error body.

export const USE_MOCK_API = import.meta.env?.VITE_MOCK_API === '1'

let authToken = null
export function setAuthToken(token) { authToken = token || null }
export function getAuthToken() { return authToken }

export async function request(url, options = {}, fetchImpl = fetch) {
  const started = performance.now()
  const headers = { ...(options.headers || {}) }
  if (authToken && !headers.authorization) headers.authorization = `Bearer ${authToken}`
  const response = await fetchImpl(url, { ...options, headers })
  let data
  try {
    data = await response.json()
  } catch {
    data = null
  }
  options.signal?.throwIfAborted()
  if (!response.ok) {
    throw Object.assign(new Error(data?.error?.message || `Request failed (${response.status})`), {
      status: response.status,
      code: data?.error?.code,
    })
  }
  return { data, durationMs: Math.round(performance.now() - started), requestId: response.headers?.get?.('x-request-id') ?? null }
}

export function jsonBody(body) {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
