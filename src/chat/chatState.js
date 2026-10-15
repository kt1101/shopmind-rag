export const initialChatState = {
  open: false,
  pending: false,
  messages: [],
  nextId: 1,
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
      if (state.pending || state.messages.length === 0) return state
      const last = state.messages[state.messages.length - 1]
      if (!last || last.role !== 'error') return state
      return {
        ...state,
        pending: true,
        messages: state.messages.slice(0, -1),
      }
    }

    default:
      return state
  }
}

export function toApiMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-10)
    .map((m) => ({
      role: m.role,
      content: m.content,
    }))
}
