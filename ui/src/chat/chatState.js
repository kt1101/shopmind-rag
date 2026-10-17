export const initialChatState = {
  open: false,
  pending: false,
  messages: [],
  nextId: 1,
  // { product_id, title } while the chat answers questions about one product.
  scope: null,
  // Server-side conversation id (POST /chat returns it; GET /chat/sessions/{id} restores it).
  sessionId: null,
  // Live progress of the pending reply, fed by SSE events: {intent, steps, text, products}.
  live: null,
}

function toScope(product) {
  return product ? { product_id: product.product_id, title: product.title } : null
}

const EMPTY_LIVE = { intent: null, standalone: null, steps: [], text: '', products: null }

// Upserts a `step` SSE event ({id, step, status, summary, duration_ms}) keeping first-seen order.
export function applyStep(steps = [], event = {}) {
  if (!event || (!event.id && !event.step)) return steps
  const id = event.id ?? event.step
  const index = steps.findIndex((s) => s.id === id)
  const next = { id, step: event.step ?? steps[index]?.step ?? id, status: event.status === 'done' ? 'done' : 'started', summary: event.summary ?? steps[index]?.summary ?? '', durationMs: event.duration_ms ?? steps[index]?.durationMs ?? null }
  if (index === -1) return [...steps, next]
  return steps.map((s, i) => (i === index ? next : s))
}

export function chatReducer(state = initialChatState, action = {}) {
  switch (action?.type) {
    case 'open': {
      if (state.open) return state
      return { ...state, open: true }
    }

    case 'close': {
      if (!state.open) return state
      return { ...state, open: false }
    }

    case 'send': {
      if (typeof action.content !== 'string') return state
      const content = action.content.trim()
      const image = action.image && action.image.token ? action.image : null
      if ((!content && !image) || state.pending) return state
      return {
        ...state,
        pending: true,
        live: EMPTY_LIVE,
        messages: [
          ...state.messages,
          { id: state.nextId, role: 'user', content, scope: state.scope, ...(image ? { image } : {}) },
        ],
        nextId: state.nextId + 1,
      }
    }

    // --- streaming events (ignored unless a reply is pending)
    case 'meta': {
      if (!state.pending) return state
      return {
        ...state,
        sessionId: action.session_id || state.sessionId,
        live: { ...(state.live || EMPTY_LIVE), intent: action.intent ?? null, standalone: action.standalone_question ?? null },
      }
    }

    case 'step': {
      if (!state.pending) return state
      const live = state.live || EMPTY_LIVE
      return { ...state, live: { ...live, steps: applyStep(live.steps, action.event) } }
    }

    case 'products': {
      if (!state.pending) return state
      return { ...state, live: { ...(state.live || EMPTY_LIVE), products: Array.isArray(action.items) ? action.items : [] } }
    }

    case 'delta': {
      if (!state.pending || typeof action.text !== 'string') return state
      const live = state.live || EMPTY_LIVE
      return { ...state, live: { ...live, text: live.text + action.text } }
    }

    case 'reset': {
      if (!state.pending) return state
      return { ...state, live: { ...(state.live || EMPTY_LIVE), text: '' } }
    }

    case 'receive': {
      if (!state.pending) return state
      return {
        ...state,
        pending: false,
        live: null,
        sessionId: action.sessionId || state.sessionId,
        messages: [
          ...state.messages,
          {
            id: state.nextId,
            role: 'assistant',
            content: action.answer ?? '',
            sources: action.sources ?? [],
            kind: action.kind ?? 'search',
            evidence: action.evidence ?? null,
            ...(action.products ? { products: action.products } : {}),
            ...(action.intent ? { intent: action.intent } : {}),
            ...(action.standalone ? { standalone: action.standalone } : {}),
            ...(action.traceId ? { traceId: action.traceId } : {}),
            ...(action.trace ? { trace: action.trace } : {}),
            ...(action.question ? { question: action.question } : {}),
          },
        ],
        nextId: state.nextId + 1,
      }
    }

    case 'fail': {
      if (!state.pending) return state
      return {
        ...state,
        pending: false,
        live: null,
        messages: [...state.messages, { id: state.nextId, role: 'error', content: action.message ?? '' }],
        nextId: state.nextId + 1,
      }
    }

    case 'retry': {
      // Scope dividers may follow the failed turn; the error is the last real message.
      if (state.pending) return state
      const index = state.messages.findLastIndex((m) => m.role !== 'scope')
      if (index === -1 || state.messages[index].role !== 'error') return state
      return {
        ...state,
        pending: true,
        live: EMPTY_LIVE,
        messages: state.messages.filter((_, i) => i !== index),
      }
    }

    case 'setScope': {
      const scope = toScope(action.product)
      if ((scope?.product_id ?? null) === (state.scope?.product_id ?? null)) return state
      if (state.messages.length === 0) return { ...state, scope }
      return {
        ...state,
        scope,
        messages: [...state.messages, { id: state.nextId, role: 'scope', product: scope }],
        nextId: state.nextId + 1,
      }
    }

    // Restore a conversation from GET /chat/sessions/{id} (only into an empty chat).
    case 'hydrate': {
      if (state.messages.length || state.pending || !Array.isArray(action.messages)) return state
      let nextId = state.nextId
      const messages = action.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m) => {
          const message = m.role === 'user'
            ? { id: nextId, role: 'user', content: m.content ?? '', scope: null }
            : { id: nextId, role: 'assistant', content: m.content ?? '', sources: m.sources ?? [], kind: 'chat', evidence: null, ...(m.products ? { products: m.products } : {}) }
          nextId += 1
          return message
        })
      return { ...state, sessionId: action.sessionId ?? state.sessionId, messages, nextId }
    }

    case 'newChat': {
      return { ...state, pending: false, live: null, messages: [], sessionId: null }
    }

    default:
      return state
  }
}

// Conversation history for POST /chat: the last turns as {role, content}.
export function historyFor(messages = [], limit = 8) {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }))
}
