import * as defaultApi from '../api.js'

// Statuses that mean "the /chat endpoint is not deployed": fall back to the A3/A1 endpoints.
const MISSING_ENDPOINT = new Set([404, 405, 501])

export function normalizeChatPayload(data, question) {
  const intent = data?.intent ?? null
  const products = Array.isArray(data?.products) ? data.products : null
  return {
    kind: 'chat',
    answer: data?.answer ?? '',
    sources: Array.isArray(data?.sources) ? data.sources : [],
    products,
    intent,
    standalone: data?.standalone_question && data.standalone_question !== question ? data.standalone_question : null,
    evidence: { insufficient_evidence: Boolean(data?.insufficient_evidence), metadata: data?.metadata ?? {} },
    sessionId: data?.session_id ?? null,
    traceId: data?.trace_id ?? null,
    trace: data?.trace ?? null,
    question,
  }
}

// F2 assistant: POST /chat/stream (SSE). `onEvent` receives every event; unknown events are
// ignored by the reducer. Without the chat endpoint (older backend, or a test api without
// chatStream) the A3 endpoint answers scoped questions and A1 search answers the rest.
export async function fetchReply({ question, scope, history = [], sessionId, imageToken, explain = false, signal, onEvent, api = defaultApi }) {
  if (typeof api.chatStream === 'function') {
    try {
      const { data } = await api.chatStream({ message: question, history, productId: scope?.product_id, sessionId, imageToken, explain, signal, onEvent })
      return normalizeChatPayload(data, question)
    } catch (error) {
      if (!MISSING_ENDPOINT.has(error?.status)) throw error
    }
  }
  return legacyReply({ question, scope, signal, api })
}

async function legacyReply({ question, scope, signal, api }) {
  if (scope) {
    const { data } = await api.askProduct({ question, productId: scope.product_id, sources: ['product'], debug: true, signal })
    return {
      kind: 'rag',
      answer: data?.answer ?? '',
      sources: data?.sources ?? [],
      evidence: { insufficient_evidence: Boolean(data?.insufficient_evidence), metadata: data?.metadata ?? {} },
    }
  }

  const { data } = await api.searchText({ query: question, topK: 3, filters: {}, signal })
  const results = data?.results ?? []
  return {
    kind: 'search',
    answer: results.length
      ? `Here are the closest matches for "${question}". Choose "Ask about this" to get answers about one of them.`
      : `I couldn't find products matching "${question}". Try different words.`,
    sources: results,
  }
}

// Progress line for live `step` events: consecutive steps of the same type merge.
export function progressItems(steps = []) {
  const items = []
  for (const s of steps) {
    const last = items[items.length - 1]
    if (last && last.step === s.step) {
      last.status = s.status === 'done' && last.status === 'done' ? 'done' : s.status === 'started' ? 'started' : last.status
      last.count += 1
      continue
    }
    items.push({ step: s.step, status: s.status, count: 1, summary: s.summary || '' })
  }
  return items
}

// Number of sources named in a multi_source_retrieve summary ("2 product, 3 review" -> 2).
export function sourceCount(summary) {
  const parts = String(summary || '').split(',').map((p) => p.trim()).filter((p) => /^\d+\s+\S+/.test(p))
  return parts.length || null
}
