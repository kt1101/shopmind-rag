export const initialChatState = {
  open: false,
  pending: false,
  messages: [],
  nextId: 1,
  // { product_id, title } while the chat answers questions about one product.
  scope: null,
}

function toScope(product) {
  return product ? { product_id: product.product_id, title: product.title } : null
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
      if (!content || state.pending) return state
      return {
        ...state,
        pending: true,
        messages: [
          ...state.messages,
          {
            id: state.nextId,
            role: 'user',
            content,
            scope: state.scope,
          },
        ],
        nextId: state.nextId + 1,
      }
    }

    case 'receive': {
      if (!state.pending) return state
      return {
        ...state,
        pending: false,
        messages: [
          ...state.messages,
          {
            id: state.nextId,
            role: 'assistant',
            content: action.answer ?? '',
            sources: action.sources ?? [],
            kind: action.kind ?? 'search',
            evidence: action.evidence ?? null,
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
        messages: [
          ...state.messages,
          {
            id: state.nextId,
            role: 'error',
            content: action.message ?? '',
          },
        ],
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

    default:
      return state
  }
}
