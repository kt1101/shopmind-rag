import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react'
import { chatReducer, initialChatState, toApiMessages } from './chatState.js'
import { sendChatMessage } from '../api.js'

export const ChatContext = createContext(null)

export function ChatProvider({ children, initial = initialChatState }) {
  const [state, dispatch] = useReducer(chatReducer, initial)
  const messagesRef = useRef(state.messages)
  messagesRef.current = state.messages

  useEffect(() => {
    if (!state.pending) return

    const controller = new AbortController()

    sendChatMessage({
      messages: toApiMessages(messagesRef.current),
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          dispatch({
            type: 'receive',
            answer: res?.data?.answer,
            sources: res?.data?.sources ?? [],
          })
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

  const value = useMemo(
    () => ({
      open: state.open,
      pending: state.pending,
      messages: state.messages,
      openChat,
      closeChat,
      send,
      retry,
    }),
    [state.open, state.pending, state.messages, openChat, closeChat, send, retry],
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
