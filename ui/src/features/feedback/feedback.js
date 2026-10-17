// F4 feedback: payload for POST /feedback and the widget state machine.

export const RATINGS = { up: 1, down: -1 }
export const MAX_COMMENT = 500

export function buildFeedback({ target, traceId, rating, productId, query, comment } = {}) {
  if (target !== 'search' && target !== 'answer') return null
  if (rating !== 1 && rating !== -1) return null
  if (!traceId) return null
  const payload = { target, traceId, rating }
  if (productId) payload.productId = productId
  if (query && String(query).trim()) payload.query = String(query).trim()
  const text = String(comment || '').trim().slice(0, MAX_COMMENT)
  if (text) payload.comment = text
  return payload
}

// idle -> rated (comment box open) -> sending -> sent | error
export function feedbackReducer(state, action) {
  switch (action.type) {
    case 'rate':
      if (state.status === 'sending' || state.status === 'sent') return state
      return { ...state, status: 'rated', rating: action.rating }
    case 'comment':
      return { ...state, comment: String(action.comment ?? '').slice(0, MAX_COMMENT) }
    case 'send':
      return state.rating ? { ...state, status: 'sending' } : state
    case 'sent':
      return { ...state, status: 'sent' }
    case 'error':
      return { ...state, status: 'error', error: action.error ?? null }
    case 'reset':
      return initialFeedback
    default:
      return state
  }
}

export const initialFeedback = { status: 'idle', rating: null, comment: '', error: null }
