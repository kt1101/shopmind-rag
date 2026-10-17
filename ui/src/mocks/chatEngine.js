// Mock shopping assistant (POST /chat, /chat/stream, /chat/image, /chat/sessions/{id}).
// One-step intent routing (product_search | product_question | policy_question | compare |
// chitchat), follow-up resolution against the session's last product list ("cái thứ hai"),
// and the SSE event sequence meta -> step* -> products? -> delta* -> done.

import { PRODUCTS } from './fixtures.js'
import { planEngine } from './planEngine.js'
import { compareEngine, runRag } from './ragEngine.js'
import { hash, newTraceId, searchComposeEngine, searchImageEngine, searchTextEngine } from './searchEngine.js'
import { readJSON, writeJSON } from '../shared/lib/storage.js'

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits

export const CHITCHAT_TEXT = 'Mình là trợ lý mua sắm ShopMind. Bạn có thể: tìm sản phẩm ("ba lô đen chống nước"), gửi ảnh để tìm sản phẩm giống, hỏi về một sản phẩm ("cái thứ hai có chống nước không?"), hỏi chính sách đổi trả/giao hàng, so sánh 2–3 sản phẩm, hoặc nhờ lên kế hoạch mua sắm ("chuẩn bị đi biển 5 ngày, ngân sách 300$").'

// Occasion / budget phrasing -> intent shopping_plan (docs/API_CONTRACT.md "Shopping planner").
const PLAN_PATTERN = /(chuẩn bị|lên kế hoạch|kế hoạch mua|ngân sách|\bbudget\b|shopping (plan|list)|\bplan\b|getting ready|chuyển (vào|nhà)|nhà mới|cần mua (gì|những gì)|quà sinh nhật|birthday gift|đi biển|beach trip|cún con|chó con|new puppy)/

// Sessions survive a page reload in the browser (localStorage) so GET /chat/sessions/{id}
// can be demoed in mock mode; in Node tests storage is absent and they live in memory only.
const SESSIONS_KEY = 'shopmind.mock.chatSessions'
const sessions = new Map(Object.entries(readJSON(SESSIONS_KEY, {}) || {}).map(([id, s]) => [id, { messages: s.messages || [], lastProducts: s.lastProducts || [] }]))
const imageTokens = new Map()

function persistSessions() {
  const recent = [...sessions.entries()].slice(-10)
  writeJSON(SESSIONS_KEY, Object.fromEntries(recent))
}

export function resetChatMock() {
  sessions.clear()
  imageTokens.clear()
  persistSessions()
}

export function storeChatImage(file) {
  const token = `img_${hash(`${file?.name}|${file?.size}|${imageTokens.size}`).toString(16)}`
  imageTokens.set(token, { name: file?.name || 'upload', size: file?.size ?? 0 })
  return { image_token: token, expires_in: 900 }
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return null
  return { session_id: sessionId, messages: session.messages.map(({ _products, ...m }) => m) }
}

const ORDINALS = [
  [/(thứ nhất|đầu tiên|\bfirst\b|\b1st\b)/i, 0],
  [/(thứ hai|\bsecond\b|\b2nd\b)/i, 1],
  [/(thứ ba|\bthird\b|\b3rd\b)/i, 2],
]

export function routeIntent(message, { hasImage = false, scoped = false } = {}) {
  const text = String(message || '').toLowerCase().trim()
  if (hasImage) return { intent: 'product_search', reason: 'image attached' }
  if (/^(hi|hello|hey|xin chào|chào|cảm ơn|thanks|thank you|help|giúp)/.test(text) || !text) return { intent: 'chitchat', reason: 'greeting/help phrase' }
  if (PLAN_PATTERN.test(text)) return { intent: 'shopping_plan', reason: 'occasion / budget request' }
  if (/(so sánh|compare|\bvs\b|khác nhau)/.test(text)) return { intent: 'compare', reason: 'comparison keyword' }
  if (/(đổi trả|trả hàng|trả lại|hoàn tiền|giao hàng|vận chuyển|bảo hành|chính sách|return|refund|shipping|warranty|policy)/.test(text)) {
    return { intent: 'policy_question', reason: 'policy keyword' }
  }
  if (scoped || ORDINALS.some(([re]) => re.test(text)) || /(\bnó\b|sản phẩm này|cái này|\bit\b|this one|có .+ không\??$|\?$)/.test(text)) {
    return { intent: 'product_question', reason: scoped ? 'chat is scoped to a product' : 'question about a product' }
  }
  return { intent: 'product_search', reason: 'descriptive product request' }
}

function referencedProduct(message, session) {
  const last = session?.lastProducts || []
  for (const [re, index] of ORDINALS) if (re.test(message) && last[index]) return last[index]
  return null
}

function step(id, stepName, impl, started, duration, summary, extra = {}) {
  return { id, step: stepName, impl, params: extra.params || {}, started_ms: round(started), duration_ms: round(duration), summary, ...(extra.details ? { details: extra.details } : {}), ...(extra.output ? { output: extra.output } : {}) }
}

function shift(steps, offset) {
  return steps.map((s) => ({ ...s, started_ms: round((s.started_ms ?? 0) + offset) }))
}

// Builds the full reply: {events: [{event, data}], payload} — payload is the POST /chat body.
export function chatReply({ message = '', history = [], product_id: productId, session_id: sessionIdIn, image_token: imageToken, explain = false } = {}) {
  const sessionId = sessionIdIn && sessions.has(sessionIdIn) ? sessionIdIn : sessionIdIn || `s_${hash(`${message}|${Date.now()}|${sessions.size}`).toString(16)}`
  const session = sessions.get(sessionId) || { messages: [], lastProducts: [] }
  sessions.set(sessionId, session)
  const traceId = newTraceId(`chat|${message}`)
  const image = imageToken ? imageTokens.get(imageToken) : null
  if (imageToken && !image) {
    throw Object.assign(new Error('image token expired or unknown'), { status: 422, code: 'image_token_invalid' })
  }

  const steps = []
  const events = []
  let clock = 0

  // rewrite
  const reference = referencedProduct(message, session)
  const scopedProduct = productId ? PRODUCTS.find((p) => p.product_id === productId) : reference
  const standalone = reference && !productId ? `${message} (sản phẩm: ${reference.title})` : message
  steps.push(step('rewrite', 'rewrite', history.length ? 'llm' : 'passthrough', clock, history.length ? 180 : 0.2,
    standalone === message ? 'question is already standalone' : `resolved reference -> ${reference.title}`,
    { details: { original: message, standalone_question: standalone, history_turns: history.length, fallback: false } }))
  clock += steps.at(-1).duration_ms

  const routed = routeIntent(message, { hasImage: Boolean(image), scoped: Boolean(scopedProduct) })
  steps.push(step('route', 'route_intent', 'rules', clock, 0.6, `${routed.intent} (${routed.reason})`, { details: { intent: routed.intent, reason: routed.reason, method: 'rules' } }))
  clock += 0.6
  events.push({ event: 'meta', data: { standalone_question: standalone, rewrite_fallback: false, session_id: sessionId, intent: routed.intent, trace_id: traceId } })

  let answer = ''
  let sources = []
  let products
  let plan
  let insufficient = false

  if (routed.intent === 'chitchat') {
    answer = CHITCHAT_TEXT
  } else if (routed.intent === 'product_search') {
    const text = message.trim()
    let body
    if (image && text) body = searchComposeEngine({ file: image, text, top_k: 4, explain: true })
    else if (image) body = searchImageEngine({ file: image, top_k: 4, explain: true })
    else body = searchTextEngine({ query: text, mode: 'hybrid', top_k: 4, explain: true })
    steps.push(...shift(body.trace.steps, clock))
    clock += body.trace.duration_ms
    products = body.results
    session.lastProducts = products.map((r) => PRODUCTS.find((p) => p.product_id === r.product_id)).filter(Boolean)
    answer = products.length
      ? `Mình tìm được ${products.length} sản phẩm phù hợp${image ? (text ? ' với ảnh và mô tả của bạn' : ' với ảnh của bạn') : ''}. Hỏi "cái thứ hai có chống nước không?" để xem chi tiết.`
      : 'Mình chưa tìm thấy sản phẩm phù hợp. Bạn thử mô tả khác nhé.'
  } else if (routed.intent === 'shopping_plan') {
    const planned = planEngine({ request: message, explain: true })
    steps.push(...shift(planned.trace.steps, clock))
    clock += planned.trace.duration_ms
    const chosen = planned.needs.filter((n) => n.status === 'chosen')
    products = chosen.map((n, i) => ({ product_id: n.chosen.product_id, title: n.chosen.title, image_url: n.chosen.image_url, brand: n.chosen.brand, category: n.chosen.category, score: n.chosen.score, rank: i + 1 }))
    session.lastProducts = products.map((r) => PRODUCTS.find((p) => p.product_id === r.product_id)).filter(Boolean)
    plan = { needs: planned.needs.map((n) => ({ label: n.label, product_id: n.chosen?.product_id ?? null, status: n.status })), total: planned.total, budget: planned.budget }
    answer = planned.summary
    insufficient = planned.insufficient_evidence
  } else if (routed.intent === 'compare') {
    const candidates = session.lastProducts.slice(0, 2)
    if (candidates.length < 2) {
      answer = 'Hãy tìm sản phẩm trước hoặc dùng nút "Thêm vào so sánh" để chọn 2–3 sản phẩm.'
    } else {
      const compared = compareEngine({ product_ids: candidates.map((p) => p.product_id) })
      answer = `${compared.summary}\n${compared.points.map((p) => `• ${p.text} ${p.citation_ids.map((c) => `[${c}]`).join('')}`).join('\n')}`
      sources = compared.sources
      insufficient = compared.insufficient_evidence
      products = searchTextEngine({ query: '', filters: { product_id: candidates.map((p) => p.product_id) } }).results
    }
  } else {
    const ragSources = routed.intent === 'policy_question' ? (scopedProduct ? ['product', 'policy'] : ['policy']) : ['product', 'review']
    const run = runRag({ question: standalone, productIds: scopedProduct ? [scopedProduct.product_id] : [], sources: ragSources, startMs: clock, seed: sessionId })
    steps.push(...run.steps)
    clock = run.durationMs
    answer = routed.intent === 'product_question' && !scopedProduct
      ? 'Bạn đang hỏi về sản phẩm nào? Hãy mở một sản phẩm hoặc tìm kiếm trước rồi hỏi "cái thứ hai…".'
      : run.answer
    sources = scopedProduct || routed.intent === 'policy_question' ? run.sources : []
    insufficient = scopedProduct || routed.intent === 'policy_question' ? run.insufficient_evidence : true
  }

  for (const s of steps) {
    events.push({ event: 'step', data: { id: s.id, step: s.step, status: 'started', summary: s.summary } })
    events.push({ event: 'step', data: { id: s.id, step: s.step, status: 'done', summary: s.summary, duration_ms: s.duration_ms } })
  }
  if (products) events.push({ event: 'products', data: { items: products } })
  for (const chunk of answer.match(/[\s\S]{1,24}/g) || []) events.push({ event: 'delta', data: { text: chunk } })

  const payload = {
    answer,
    sources,
    insufficient_evidence: insufficient,
    standalone_question: standalone,
    session_id: sessionId,
    intent: routed.intent,
    ...(products ? { products } : {}),
    ...(plan ? { plan } : {}),
    trace_id: traceId,
  }
  if (explain) {
    payload.trace = {
      trace_id: traceId, pipeline: 'chat', kind: 'chat', created_at: new Date().toISOString(), duration_ms: round(clock + 0.5),
      input: { message, history_turns: history.length, product_id: productId ?? null, image: image ? { name: image.name } : null },
      steps,
      output: { intent: routed.intent, citation_ids: sources.map((s) => s.citation_id), product_ids: (products || []).map((p) => p.product_id) },
    }
  }
  events.push({ event: 'done', data: payload })

  const now = new Date().toISOString()
  session.messages.push({ role: 'user', content: message, created_at: now })
  session.messages.push({ role: 'assistant', content: answer, created_at: now, ...(sources.length ? { sources } : {}), ...(products ? { products } : {}) })
  persistSessions()
  return { events, payload }
}
