// In-memory mock of the Admin API (VITE_MOCK_API=1). Same function names and return shape
// ({data, durationMs}) as src/shared/api/admin.js. State resets on page reload.
// Login with admin/admin or annotator/annotator.

import { getAuthToken } from '../shared/api/http.js'
import {
  CONFIG_RULES, EFFECTIVE_CONFIG, EVAL_RUNS, HOT_RELOADABLE, INDEXES, INITIAL_JOBS, INITIAL_POLICIES,
  INITIAL_PROFILES, MOCK_USERS, PIPELINES, PRODUCTS, QUERIES, ZERO_RESULT_QUERIES,
  buildFeedback, buildJudgments, buildTrace, buildTraces, seeded,
} from './adminFixtures.js'

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

function freshState() {
  return {
    profiles: clone(INITIAL_PROFILES),
    jobs: clone(INITIAL_JOBS).map((job) => ({ ...job, startedMs: null })),
    policies: clone(INITIAL_POLICIES),
    traces: buildTraces(),
    feedback: buildFeedback(),
    judgments: buildJudgments(),
    nextId: 100,
  }
}

let state = freshState()
export function resetAdminMock() {
  state = freshState()
}

export let mockDelayMs = 250
export function setMockDelay(ms) {
  mockDelayMs = ms
}

function wait(signal) {
  const ms = mockDelayMs
  if (ms <= 0) return Promise.resolve().then(() => signal?.throwIfAborted())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }, { once: true })
  })
}

function httpError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra })
}

async function respond(signal, producer, { auth = true } = {}) {
  const started = performance.now()
  await wait(signal)
  if (auth) currentUser()
  const data = producer()
  return { data: clone(data), durationMs: Math.round(performance.now() - started), requestId: `mock-${Math.random().toString(16).slice(2, 10)}` }
}

function currentUser() {
  const token = getAuthToken()
  const match = typeof token === 'string' && token.match(/^mock-token\.([a-z]+)\.\d+$/)
  if (!match || !MOCK_USERS[match[1]]) throw httpError(401, 'unauthorized', 'Session expired, please sign in again')
  return { username: match[1], role: MOCK_USERS[match[1]].role }
}

function newId(prefix) {
  state.nextId += 1
  return `${prefix}_${state.nextId}`
}

// --- auth

export function login({ username = '', password = '', signal } = {}) {
  return respond(signal, () => {
    const user = MOCK_USERS[username.trim()]
    if (!user || user.password !== password) throw httpError(401, 'invalid_credentials', 'Invalid username or password')
    return {
      access_token: `mock-token.${username.trim()}.${Date.now()}`,
      token_type: 'bearer',
      expires_in: 7200,
      user: { username: username.trim(), role: user.role },
    }
  }, { auth: false })
}

export function getMe({ signal } = {}) {
  return respond(signal, () => currentUser())
}

// --- stats

export function getStats({ days = 7, signal } = {}) {
  return respond(signal, () => {
    const n = Math.max(1, Math.min(90, Number(days) || 7))
    const rand = seeded(n * 31)
    const end = Date.parse('2026-10-16T00:00:00Z')
    const daily = Array.from({ length: n }, (_, i) => {
      const date = new Date(end - (n - 1 - i) * 86400000).toISOString().slice(0, 10)
      const weekend = [0, 6].includes(new Date(date).getUTCDay())
      return {
        date,
        searches: Math.round((weekend ? 140 : 220) + rand() * 90 + i * 2),
        chats: Math.round((weekend ? 30 : 55) + rand() * 25),
      }
    })
    const searches = daily.reduce((s, d) => s + d.searches, 0)
    const chats = daily.reduce((s, d) => s + d.chats, 0)
    const latency = Object.fromEntries(PIPELINES.map((p) => {
      const base = p.startsWith('rag') || p === 'chat' ? 1100 : p === 'search.bm25' ? 18 : p === 'search.compose' ? 95 : 55
      const p50 = Math.round(base * (0.9 + rand() * 0.2))
      return [p, { p50, p95: Math.round(p50 * (1.8 + rand() * 0.9)) }]
    }))
    return {
      totals: {
        searches,
        chats,
        feedback_positive: Math.round(searches * 0.031),
        feedback_negative: Math.round(searches * 0.009),
        zero_result_rate: 0.042 + rand() * 0.01,
        abstain_rate: 0.118 + rand() * 0.02,
      },
      latency,
      daily,
      top_queries: QUERIES.slice(0, 8).map((query, i) => ({ query, count: Math.round((80 - i * 8) * (n / 7) + rand() * 5) })),
      zero_result_queries: ZERO_RESULT_QUERIES.map((query, i) => ({ query, count: Math.max(1, Math.round((14 - i * 2.5) * (n / 7))) })),
    }
  })
}

// --- config

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, path, out)
    else out[path] = value
  }
  return out
}

function applyOverrides(base, overrides) {
  const out = clone(base)
  for (const [path, value] of Object.entries(overrides || {})) {
    const parts = path.split('.')
    let node = out
    for (const part of parts.slice(0, -1)) node = node[part] ??= {}
    node[parts[parts.length - 1]] = value
  }
  return out
}

function activeProfile() {
  return state.profiles.find((p) => p.active) || state.profiles[0]
}

function configResponse() {
  const profile = activeProfile()
  const { id, name, created_at, created_by } = profile
  return { effective: applyOverrides(EFFECTIVE_CONFIG, profile.overrides), hot_reloadable: HOT_RELOADABLE, active_profile: { id, name, created_at, created_by } }
}

export function validateOverrides(overrides) {
  const flat = flatten(EFFECTIVE_CONFIG)
  const keys = HOT_RELOADABLE.map((k) => (typeof k === 'string' ? k : k.key))
  const details = []
  for (const [key, value] of Object.entries(overrides || {})) {
    if (!keys.includes(key)) {
      details.push({ field: key, message: 'Key is not hot-reloadable' })
      continue
    }
    const current = flat[key]
    if (typeof current === 'number') {
      const rule = CONFIG_RULES[key] || {}
      if (typeof value !== 'number' || !Number.isFinite(value)) details.push({ field: key, message: 'Input should be a valid number' })
      else if (rule.integer && !Number.isInteger(value)) details.push({ field: key, message: 'Input should be a valid integer' })
      else if (rule.min != null && value < rule.min) details.push({ field: key, message: `Input should be greater than or equal to ${rule.min}` })
      else if (rule.max != null && value > rule.max) details.push({ field: key, message: `Input should be less than or equal to ${rule.max}` })
    } else if (typeof current === 'boolean' && typeof value !== 'boolean') {
      details.push({ field: key, message: 'Input should be a valid boolean' })
    } else if (typeof current === 'string' && typeof value !== 'string') {
      details.push({ field: key, message: 'Input should be a valid string' })
    }
  }
  return details
}

export function getConfig({ signal } = {}) {
  return respond(signal, configResponse)
}

export function saveConfigProfile({ name = '', overrides = {}, signal } = {}) {
  return respond(signal, () => {
    const user = currentUser()
    const details = validateOverrides(overrides)
    if (!name.trim()) details.unshift({ field: 'name', message: 'Profile name is required' })
    if (details.length) throw httpError(422, 'validation_error', 'Config validation failed', { details })
    const base = activeProfile().overrides
    const profile = { id: newId('p'), name: name.trim(), created_at: new Date().toISOString(), created_by: user.username, overrides: { ...base, ...overrides }, active: true }
    state.profiles.forEach((p) => { p.active = false })
    state.profiles.unshift(profile)
    return { profile, effective: configResponse().effective }
  })
}

export function listConfigProfiles({ signal } = {}) {
  return respond(signal, () => ({ items: state.profiles }))
}

export function activateConfigProfile({ id, signal } = {}) {
  return respond(signal, () => {
    const profile = state.profiles.find((p) => p.id === id)
    if (!profile) throw httpError(404, 'profile_not_found', 'Profile not found')
    state.profiles.forEach((p) => { p.active = p.id === id })
    return { profile, effective: configResponse().effective }
  })
}

// --- traces

export function listTraces({ q = '', kind = '', limit = 20, offset = 0, signal } = {}) {
  return respond(signal, () => {
    const needle = q.trim().toLowerCase()
    const items = state.traces.filter((t) =>
      (!kind || t.kind === kind) && (!needle || t.trace_id.includes(needle) || t.input_summary.toLowerCase().includes(needle)))
    return { total: items.length, items: items.slice(Number(offset), Number(offset) + Number(limit)) }
  })
}

export function getTrace({ traceId, signal } = {}) {
  return respond(signal, () => {
    const summary = state.traces.find((t) => t.trace_id === traceId)
    if (!summary) throw httpError(404, 'trace_not_found', 'Trace not found')
    return buildTrace(summary)
  })
}

// --- indexes & jobs

export function listIndexes({ signal } = {}) {
  return respond(signal, () => ({ items: INDEXES }))
}

const JOB_STEPS = {
  reindex_policies: ['Loading published policies', 'Embedding 24 sections with SigLIP2 (cpu)', 'Creating index policies_a3_v4', 'Validating doc count, dims, BM25 + kNN smoke search', 'Switching alias policies -> policies_a3_v4'],
  run_eval: ['Loading benchmark (seed 42)', 'Running 150 queries', 'Computing Recall@10, nDCG@10, MRR@10', 'Writing runs/<timestamp>_mock'],
  build_embedding_map: ['Loading embeddings', 'Fitting PCA (2 components)', 'Writing embedding map'],
}
const QUEUED_MS = 1500
const STEP_MS = 1800

function materialize(job) {
  if (job.startedMs == null) return job
  const elapsed = Date.now() - job.startedMs
  const steps = JOB_STEPS[job.type] || ['Working']
  if (elapsed < QUEUED_MS) return { ...job, status: 'queued', log: 'Queued' }
  const done = Math.floor((elapsed - QUEUED_MS) / STEP_MS)
  const lines = ['Queued', 'Started', ...steps.slice(0, Math.min(done + 1, steps.length))]
  if (done < steps.length) return { ...job, status: 'running', log: lines.join('\n') }
  const fail = job.params?.fail === true
  return {
    ...job,
    status: fail ? 'failed' : 'succeeded',
    log: [...lines, fail ? 'ERROR: validation failed, alias not switched' : 'Done'].join('\n'),
    finished_at: new Date(job.startedMs + QUEUED_MS + steps.length * STEP_MS).toISOString(),
  }
}

function publicJob(job) {
  const { startedMs, ...rest } = materialize(job)
  void startedMs
  return rest
}

function createJob(type, params = {}) {
  const job = { id: newId('job'), type, status: 'queued', params, log: 'Queued', created_at: new Date().toISOString(), finished_at: null, startedMs: Date.now() }
  state.jobs.unshift(job)
  return job
}

export function listJobs({ signal } = {}) {
  return respond(signal, () => ({ items: state.jobs.map(publicJob) }))
}

export function getJob({ id, signal } = {}) {
  return respond(signal, () => {
    const job = state.jobs.find((j) => j.id === id)
    if (!job) throw httpError(404, 'job_not_found', 'Job not found')
    return publicJob(job)
  })
}

export function startJob({ type, params = {}, signal } = {}) {
  return respond(signal, () => {
    if (!JOB_STEPS[type]) throw httpError(422, 'validation_error', `Unknown job type: ${type}`)
    return publicJob(createJob(type, params))
  })
}

// --- policies

const POLICY_FIELDS = ['policy_id', 'section_id', 'title', 'content', 'policy_type', 'version']

function validatePolicy(policy) {
  const details = []
  if (!policy?.title?.trim()) details.push({ field: 'title', message: 'Title is required' })
  if (!policy?.content?.trim()) details.push({ field: 'content', message: 'Content is required' })
  if (!policy?.section_id?.trim()) details.push({ field: 'section_id', message: 'Section id is required' })
  if (!Number.isInteger(Number(policy?.version)) || Number(policy?.version) < 1) details.push({ field: 'version', message: 'Version must be a positive integer' })
  if (details.length) throw httpError(422, 'validation_error', 'Policy validation failed', { details })
}

function pickPolicy(policy) {
  const out = Object.fromEntries(POLICY_FIELDS.filter((f) => policy[f] !== undefined).map((f) => [f, policy[f]]))
  if (out.version !== undefined) out.version = Number(out.version)
  return out
}

export function listPolicies({ signal } = {}) {
  return respond(signal, () => ({ items: state.policies }))
}

export function createPolicy({ policy, signal } = {}) {
  return respond(signal, () => {
    validatePolicy(policy)
    const created = { id: newId('pol'), policy_id: policy.policy_id || policy.section_id.split('.')[0], ...pickPolicy(policy), status: 'draft', updated_at: new Date().toISOString() }
    state.policies.unshift(created)
    return created
  })
}

export function updatePolicy({ id, policy, signal } = {}) {
  return respond(signal, () => {
    const existing = state.policies.find((p) => p.id === id)
    if (!existing) throw httpError(404, 'policy_not_found', 'Policy not found')
    validatePolicy({ ...existing, ...policy })
    Object.assign(existing, pickPolicy(policy), { status: 'draft', updated_at: new Date().toISOString() })
    return existing
  })
}

export function publishPolicies({ ids, signal } = {}) {
  return respond(signal, () => {
    const targets = state.policies.filter((p) => p.status === 'draft' && (!ids || ids.includes(p.id)))
    targets.forEach((p) => {
      p.status = 'published'
      p.updated_at = new Date().toISOString()
    })
    const job = createJob('reindex_policies', { policy_ids: targets.map((p) => p.id) })
    return { job_id: job.id }
  })
}

// --- evaluation

export function listEvalRuns({ signal } = {}) {
  return respond(signal, () => ({ items: EVAL_RUNS }))
}

export function getEvalRun({ id, signal } = {}) {
  return respond(signal, () => {
    const run = EVAL_RUNS.find((r) => r.id === id)
    if (!run) throw httpError(404, 'eval_run_not_found', 'Eval run not found')
    return { ...run, summary: `Mock run ${run.name}. Placeholder metrics, not measured.` }
  })
}

// --- feedback

export function listFeedback({ limit = 20, offset = 0, rating, target, signal } = {}) {
  return respond(signal, () => {
    const items = state.feedback.filter((f) => (rating == null || rating === '' || f.rating === Number(rating)) && (!target || f.target === target))
    return { total: items.length, items: items.slice(Number(offset), Number(offset) + Number(limit)) }
  })
}

// --- annotation

export function listJudgments({ query = '', signal } = {}) {
  return respond(signal, () => {
    const user = currentUser()
    const needle = query.trim()
    return { items: state.judgments.filter((j) => j.annotator === user.username && (!needle || j.query === needle)) }
  })
}

export function saveJudgment({ query, productId, grade, signal } = {}) {
  return respond(signal, () => {
    const user = currentUser()
    if (![0, 1, 2].includes(grade)) throw httpError(422, 'validation_error', 'grade must be 0, 1 or 2')
    if (!query?.trim() || !productId) throw httpError(422, 'validation_error', 'query and product_id are required')
    const existing = state.judgments.find((j) => j.query === query.trim() && j.product_id === productId && j.annotator === user.username)
    if (existing) existing.grade = grade
    else state.judgments.push({ query: query.trim(), product_id: productId, grade, annotator: user.username })
    return { query: query.trim(), product_id: productId, grade, annotator: user.username }
  })
}

// Cohen's kappa between the first two annotators over items both judged.
export function cohensKappa(judgments) {
  const annotators = [...new Set(judgments.map((j) => j.annotator))].slice(0, 2)
  if (annotators.length < 2) return { kappa: null, pairs: 0 }
  const byItem = new Map()
  for (const j of judgments) {
    const key = `${j.query}\u0000${j.product_id}`
    const entry = byItem.get(key) || {}
    entry[j.annotator] = j.grade
    byItem.set(key, entry)
  }
  const pairs = [...byItem.values()].filter((e) => e[annotators[0]] != null && e[annotators[1]] != null)
  if (pairs.length === 0) return { kappa: null, pairs: 0 }
  const categories = [0, 1, 2]
  const observed = pairs.filter((e) => e[annotators[0]] === e[annotators[1]]).length / pairs.length
  const expected = categories.reduce((sum, c) => {
    const a = pairs.filter((e) => e[annotators[0]] === c).length / pairs.length
    const b = pairs.filter((e) => e[annotators[1]] === c).length / pairs.length
    return sum + a * b
  }, 0)
  const kappa = expected === 1 ? 1 : (observed - expected) / (1 - expected)
  return { kappa: Math.round(kappa * 1000) / 1000, pairs: pairs.length, annotators }
}

export function getAgreement({ signal } = {}) {
  return respond(signal, () => cohensKappa(state.judgments))
}

export async function exportJudgments({ signal } = {}) {
  const { data } = await respond(signal, () => {
    // qrels JSONL: one line per (query, product) using the max grade across annotators.
    const merged = new Map()
    for (const j of state.judgments) {
      const key = `${j.query}\u0000${j.product_id}`
      merged.set(key, Math.max(merged.get(key) ?? 0, j.grade))
    }
    return [...merged.entries()].map(([key, grade]) => {
      const [query, product_id] = key.split('\u0000')
      return JSON.stringify({ query, product_id, grade })
    }).join('\n')
  })
  return { data: { blob: new Blob([`${data}\n`], { type: 'application/x-ndjson' }), filename: 'qrels_mock.jsonl' } }
}

export function searchForAnnotation({ query = '', topK = 10, signal } = {}) {
  return respond(signal, () => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const scored = PRODUCTS.map((p) => {
      const text = `${p.title} ${p.brand} ${p.category}`.toLowerCase()
      const hits = terms.filter((t) => text.includes(t)).length
      return { ...p, score: hits + (p.product_id.charCodeAt(9) % 7) / 10 }
    }).sort((a, b) => b.score - a.score)
    const results = scored.slice(0, topK).map((p, i) => ({ ...p, image_url: null, score: Math.round(p.score * 1000) / 1000, rank: i + 1 }))
    return { query, mode: 'hybrid', filter_only: false, results, trace_id: `mock-${Date.now()}` }
  }, { auth: false })
}
