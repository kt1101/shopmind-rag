import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { getChatSession } from '../api.js'
import { readJSON, removeKey, writeJSON } from '../shared/lib/storage.js'
import { chatReducer, historyFor, initialChatState } from './chatState.js'
import { fetchReply } from './chatReply.js'

export const ChatContext = createContext(null)
const SESSION_KEY = 'shopmind.chat.session'
const EXPLAIN_KEY = 'shopmind.explain'

// SSE event -> reducer action. Unknown events are ignored on purpose.
export function eventToAction(evt) {
  const data = evt?.data && typeof evt.data === 'object' ? evt.data : {}
  switch (evt?.event) {
    case 'meta': return { type: 'meta', ...data }
    case 'step': return { type: 'step', event: data }
    case 'products': return { type: 'products', items: data.items }
    case 'delta': return { type: 'delta', text: data.text }
    case 'reset': return { type: 'reset', reason: data.reason }
    default: return null
  }
}

export function ChatProvider({ children, initial = initialChatState }) {
  const [state, dispatch] = useReducer(chatReducer, initial)
  const [explain, setExplainState] = useState(() => readJSON(EXPLAIN_KEY, true) !== false)
  const stateRef = useRef(state)
  stateRef.current = state
  const explainRef = useRef(explain)
  explainRef.current = explain

  // Restore the previous conversation (server-side session) once.
  useEffect(() => {
    const stored = readJSON(SESSION_KEY, null)
    if (!stored || typeof stored !== 'string') return undefined
    const controller = new AbortController()
    getChatSession({ sessionId: stored, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted && Array.isArray(res?.data?.messages)) {
          dispatch({ type: 'hydrate', sessionId: stored, messages: res.data.messages })
        }
      })
      .catch((err) => {
        if (err?.status === 404) removeKey(SESSION_KEY)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (state.sessionId) writeJSON(SESSION_KEY, state.sessionId)
  }, [state.sessionId])

  useEffect(() => {
    if (!state.pending) return undefined
    const { messages, sessionId } = stateRef.current
    const index = messages.findLastIndex((m) => m.role === 'user')
    if (index === -1) return undefined
    const question = messages[index]
    const controller = new AbortController()

    fetchReply({
      question: question.content,
      scope: question.scope,
      history: historyFor(messages.slice(0, index)),
      sessionId,
      imageToken: question.image?.token,
      explain: explainRef.current,
      signal: controller.signal,
      onEvent: (evt) => {
        if (controller.signal.aborted) return
        const action = eventToAction(evt)
        if (action) dispatch(action)
      },
    })
      .then((reply) => {
        if (!controller.signal.aborted) dispatch({ type: 'receive', ...reply })
      })
      .catch((err) => {
        if (!controller.signal.aborted && err?.name !== 'AbortError') {
          dispatch({ type: 'fail', message: err?.message || 'Request failed' })
        }
      })

    return () => controller.abort()
  }, [state.pending])

  const openChat = useCallback(() => dispatch({ type: 'open' }), [])
  const closeChat = useCallback(() => dispatch({ type: 'close' }), [])
  const send = useCallback((content, image) => dispatch({ type: 'send', content, image }), [])
  const retry = useCallback(() => dispatch({ type: 'retry' }), [])
  const setScope = useCallback((product) => dispatch({ type: 'setScope', product }), [])
  const newChat = useCallback(() => {
    removeKey(SESSION_KEY)
    dispatch({ type: 'newChat' })
  }, [])
  const setExplain = useCallback((value) => {
    setExplainState(value)
    writeJSON(EXPLAIN_KEY, value)
  }, [])

  const value = useMemo(
    () => ({
      open: state.open,
      pending: state.pending,
      messages: state.messages,
      scope: state.scope,
      live: state.live,
      explain,
      openChat,
      closeChat,
      send,
      retry,
      setScope,
      newChat,
      setExplain,
    }),
    [state.open, state.pending, state.messages, state.scope, state.live, explain, openChat, closeChat, send, retry, setScope, newChat, setExplain],
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
