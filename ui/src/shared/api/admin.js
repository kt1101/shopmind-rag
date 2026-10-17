// Admin Console API (docs/API_CONTRACT.md, "Admin (JWT)").
// Every function resolves to {data, durationMs, requestId} like shared/api/http.js `request`.
// With VITE_MOCK_API=1 the calls are served by src/mocks/adminMock.js.
// A 401 from any admin call invokes the handler registered with `onUnauthorized` (logout).

import { USE_MOCK_API, getAuthToken, jsonBody, request } from './http.js'

const ADMIN = '/api/v1/admin'

let unauthorizedHandler = null
export function onUnauthorized(handler) {
  unauthorizedHandler = handler
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null
  }
}

async function loadMock() {
  return import('../../mocks/adminMock.js')
}

// Like `request`, but keeps the parsed error body on the thrown error (`err.body`,
// `err.details`) so 422 validation details can be shown inline.
async function adminRequest(url, options = {}) {
  let captured = null
  const fetchImpl = async (u, o) => {
    const response = await fetch(u, o)
    try {
      captured = response.clone()
    } catch {
      captured = null
    }
    return response
  }
  try {
    return await request(url, options, fetchImpl)
  } catch (error) {
    if (captured && error.status && error.body === undefined) {
      try {
        error.body = await captured.json()
      } catch {
        error.body = null
      }
      error.details = error.body?.error?.details ?? error.body?.detail
    }
    throw error
  }
}

async function call(mockName, args, url, options) {
  try {
    if (USE_MOCK_API) return await (await loadMock())[mockName](args || {})
    return await adminRequest(url, { ...options, signal: args?.signal })
  } catch (error) {
    if (error?.status === 401 && mockName !== 'login') unauthorizedHandler?.(error)
    throw error
  }
}

function qs(params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

function put(body) {
  return { ...jsonBody(body), method: 'PUT' }
}

// --- auth
export const login = (args) => call('login', args, `${ADMIN}/auth/login`, jsonBody({ username: args.username, password: args.password }))
export const getMe = (args = {}) => call('getMe', args, `${ADMIN}/auth/me`)

// --- dashboard
export const getStats = (args = {}) => call('getStats', args, `${ADMIN}/stats${qs({ days: args.days ?? 7 })}`)

// --- config
export const getConfig = (args = {}) => call('getConfig', args, `${ADMIN}/config`)
export const saveConfigProfile = (args) => call('saveConfigProfile', args, `${ADMIN}/config`, put({ name: args.name, overrides: args.overrides }))
export const listConfigProfiles = (args = {}) => call('listConfigProfiles', args, `${ADMIN}/config/profiles`)
export const activateConfigProfile = (args) =>
  call('activateConfigProfile', args, `${ADMIN}/config/profiles/${encodeURIComponent(args.id)}/activate`, jsonBody({}))

// --- traces
export const listTraces = (args = {}) =>
  call('listTraces', args, `${ADMIN}/traces${qs({ q: args.q, kind: args.kind, limit: args.limit ?? 20, offset: args.offset ?? 0 })}`)
export const getTrace = (args) => call('getTrace', args, `/api/v1/traces/${encodeURIComponent(args.traceId)}`)

// --- indexes & jobs
export const listIndexes = (args = {}) => call('listIndexes', args, `${ADMIN}/indexes`)
export const listJobs = (args = {}) => call('listJobs', args, `${ADMIN}/jobs`)
export const getJob = (args) => call('getJob', args, `${ADMIN}/jobs/${encodeURIComponent(args.id)}`)
export const startJob = (args) => call('startJob', args, `${ADMIN}/jobs`, jsonBody({ type: args.type, params: args.params || {} }))

// --- policies
export const listPolicies = (args = {}) => call('listPolicies', args, `${ADMIN}/policies`)
export const createPolicy = (args) => call('createPolicy', args, `${ADMIN}/policies`, jsonBody(args.policy))
export const updatePolicy = (args) => call('updatePolicy', args, `${ADMIN}/policies/${encodeURIComponent(args.id)}`, put(args.policy))
// `ids` is optional: without it the backend publishes every draft.
export const publishPolicies = (args = {}) =>
  call('publishPolicies', args, `${ADMIN}/policies/publish`, jsonBody(args.ids ? { ids: args.ids } : {}))

// --- evaluation
export const listEvalRuns = (args = {}) => call('listEvalRuns', args, `${ADMIN}/eval-runs`)
export const getEvalRun = (args) => call('getEvalRun', args, `${ADMIN}/eval-runs/${encodeURIComponent(args.id)}`)

// --- feedback
export const listFeedback = (args = {}) =>
  call('listFeedback', args, `${ADMIN}/feedback${qs({ limit: args.limit ?? 20, offset: args.offset ?? 0, rating: args.rating, target: args.target })}`)

// --- annotation
export const listJudgments = (args = {}) => call('listJudgments', args, `${ADMIN}/judgments${qs({ query: args.query })}`)
export const saveJudgment = (args) =>
  call('saveJudgment', args, `${ADMIN}/judgments`, jsonBody({ query: args.query, product_id: args.productId, grade: args.grade }))
export const getAgreement = (args = {}) => call('getAgreement', args, `${ADMIN}/judgments/agreement`)

// Current top-k for a query (public search endpoint) so annotators grade what users see.
export const searchForAnnotation = (args) =>
  call('searchForAnnotation', args, '/api/v1/search/text', jsonBody({ query: (args.query || '').trim(), mode: args.mode || 'hybrid', top_k: args.topK ?? 10 }))

// Downloads qrels JSONL. Not JSON, so this bypasses `request` and returns {blob, filename}.
export async function exportJudgments(args = {}) {
  try {
    if (USE_MOCK_API) return await (await loadMock()).exportJudgments(args)
    const token = getAuthToken()
    const response = await fetch(`${ADMIN}/judgments/export`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: args.signal,
    })
    if (!response.ok) {
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      throw Object.assign(new Error(body?.error?.message || `Export failed (${response.status})`), { status: response.status, code: body?.error?.code })
    }
    const disposition = response.headers.get('content-disposition') || ''
    const match = disposition.match(/filename="?([^";]+)"?/i)
    return { data: { blob: await response.blob(), filename: match?.[1] || 'qrels.jsonl' } }
  } catch (error) {
    if (error?.status === 401) unauthorizedHandler?.(error)
    throw error
  }
}
