import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { chatReducer, initialChatState } from './chatState.js'
import { fetchReply } from './chatReply.js'

export const ChatContext = createContext(null)

export function ChatProvider({ children, initial = initialChatState }) {
  const [state, dispatch] = useReducer(chatReducer, initial)
  const messagesRef = useRef(state.messages)
  messagesRef.current = state.messages

  useEffect(() => {
    if (!state.pending) return

    const question = messagesRef.current.findLast((m) => m.role === 'user')
    if (!question) return

    const controller = new AbortController()

    fetchReply({ question: question.content, scope: question.scope, signal: controller.signal })
      .then((reply) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'receive', ...reply })
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted && err?.name !== 'AbortError') {
          dispatch({
            type: 'fail',
            message: err?.message || 'Request failed',
          })
        }
      })

    return () => {
      controller.abort()
    }
  }, [state.pending])

  const openChat = useCallback(() => dispatch({ type: 'open' }), [])
  const closeChat = useCallback(() => dispatch({ type: 'close' }), [])
  const send = useCallback((content) => dispatch({ type: 'send', content }), [])
  const retry = useCallback(() => dispatch({ type: 'retry' }), [])
  const setScope = useCallback((product) => dispatch({ type: 'setScope', product }), [])

  const value = useMemo(
    () => ({
      open: state.open,
      pending: state.pending,
      messages: state.messages,
      scope: state.scope,
      openChat,
      closeChat,
      send,
      retry,
      setScope,
    }),
    [state.open, state.pending, state.messages, state.scope, openChat, closeChat, send, retry, setScope],
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat() {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider')
  }
  return context
}
