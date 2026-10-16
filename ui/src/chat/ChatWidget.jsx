import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useChat } from './ChatProvider.jsx'
import { resolveImageUrl } from '../api.js'
import { productPath } from '../lib/urlState.js'
import './chat.css'

const CATALOG_SUGGESTIONS = [
  'Waterproof hiking boots',
  'Running shoes for daily training',
  'Black backpacks',
]

const PRODUCT_SUGGESTIONS = [
  'What material is it made of?',
  'Is it waterproof?',
  'How much does it weigh?',
]

function ChatEvidence({ evidence, sources }) {
  const missing = evidence?.metadata?.missing_sources ?? []
  return (
    <>
      {evidence?.insufficient_evidence && (
        <p className="chat-evidence-warning">Not enough evidence for a reliable answer.</p>
      )}
      {missing.length > 0 && <p className="chat-evidence-warning">No usable evidence for: {missing.join(', ')}.</p>}
      {evidence?.metadata?.truncated_ids?.length > 0 && (
        <p className="chat-evidence-warning">Some evidence was shortened to excerpts.</p>
      )}
      {sources.length > 0 && (
        <div className="chat-citations">
          <p className="chat-citations-title">Cited sources</p>
          <ol>
            {sources.map((source) => (
              <li key={source.document_id}>
                <span className="chat-citation-type">{source.source}</span>
                <span className="chat-citation-title">{source.title}</span>
                {Number.isFinite(source.score) && <span className="chat-citation-score">{source.score.toFixed(2)}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </>
  )
}

function ChatSourceCard({ source, onAsk }) {
  const [broken, setBroken] = useState(false)
  const image = resolveImageUrl(source?.image_url)
  const title = source?.title || 'Product'

  return (
    <div className="chat-source">
      <Link to={productPath(source?.product_id)} className="chat-source-card">
        <div className="chat-source-thumb">
          {image && !broken ? (
            <img
              src={image}
              alt={title}
              loading="lazy"
              onError={() => setBroken(true)}
            />
          ) : (
            <span aria-hidden="true" className="chat-source-placeholder">
              ◇
            </span>
          )}
        </div>
        <span className="chat-source-title">{title}</span>
      </Link>
      <button type="button" className="chat-source-ask" onClick={() => onAsk(source)}>
        Ask about this
      </button>
    </div>
  )
}

export default function ChatWidget() {
  const { open, pending, messages, scope, openChat, closeChat, send, retry, setScope } = useChat()
  const [input, setInput] = useState('')
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)

  // Focus input when opened
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  // Esc key listener closes the panel
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        closeChat()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, closeChat])

  // Auto-scroll to newest message
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' })
    }
  }, [open, messages, pending])

  function handleSend() {
    const trimmed = input.trim()
    if (!trimmed || pending) return
    send(trimmed)
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    handleSend()
  }

  return (
    <>
      <button
        type="button"
        className={`chat-launcher ${open ? 'chat-launcher--hidden' : ''}`}
        aria-label="Open shopping assistant"
        aria-expanded={open}
        onClick={openChat}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="ShopMind Assistant"
          className="chat-panel"
        >
          <div className="chat-header">
            <div className="chat-header-info">
              <h2 className="chat-title">ShopMind Assistant</h2>
              <p className="chat-subtitle">{scope ? 'Answers cite product evidence' : 'Searching the catalog'}</p>
            </div>
            <button
              type="button"
              className="chat-close-button"
              aria-label="Close assistant"
              onClick={closeChat}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {scope && (
            <div className="chat-scope">
              <span>Asking about <strong>{scope.title}</strong></span>
              <button type="button" aria-label="Stop asking about this product" onClick={() => setScope(null)}>
                ×
              </button>
            </div>
          )}

          <div className="chat-messages" aria-live="polite">
            {messages.length === 0 && (
              <div className="chat-empty-state">
                <p className="chat-greeting">
                  {scope
                    ? `Ask me anything about ${scope.title}. I'll answer from its product evidence.`
                    : 'Hi! Describe what you need and I\'ll find matching products.'}
                </p>
                <div className="chat-suggestions">
                  {(scope ? PRODUCT_SUGGESTIONS : CATALOG_SUGGESTIONS).map((chipText) => (
                    <button
                      key={chipText}
                      type="button"
                      className="chat-suggestion-chip"
                      onClick={() => send(chipText)}
                    >
                      {chipText}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="chat-message chat-message--user">
                    <div className="chat-bubble chat-bubble--user">
                      <p className="chat-bubble-text">{msg.content}</p>
                    </div>
                  </div>
                )
              }

              if (msg.role === 'scope') {
                return (
                  <p key={msg.id} className="chat-scope-divider">
                    {msg.product ? `Now asking about ${msg.product.title}` : 'Back to searching the catalog'}
                  </p>
                )
              }

              if (msg.role === 'error') {
                return (
                  <div key={msg.id} className="chat-message chat-message--error">
                    <div className="chat-bubble chat-bubble--error">
                      <p className="chat-bubble-text">Couldn't reach the assistant</p>
                      <button
                        type="button"
                        className="chat-retry-button"
                        onClick={retry}
                      >
                        Retry
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div key={msg.id} className="chat-message chat-message--assistant">
                  <div className="chat-bubble chat-bubble--assistant">
                    <p className="chat-bubble-text">{msg.content}</p>
                    {msg.kind === 'rag' ? (
                      <ChatEvidence evidence={msg.evidence} sources={msg.sources ?? []} />
                    ) : (
                      Array.isArray(msg.sources) && msg.sources.length > 0 && (
                        <div className="chat-sources">
                          {msg.sources.map((source, sIdx) => (
                            <ChatSourceCard
                              key={source.product_id || sIdx}
                              source={source}
                              onAsk={setScope}
                            />
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )
            })}

            {pending && (
              <div
                className="chat-message chat-message--assistant chat-message--pending"
                aria-label="Assistant is typing"
              >
                <div className="chat-bubble chat-bubble--assistant chat-typing-indicator">
                  <span className="chat-dot" />
                  <span className="chat-dot" />
                  <span className="chat-dot" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} tabIndex={-1} aria-hidden="true" />
          </div>

          <div className="chat-input-area">
            <form onSubmit={handleSubmit} className="chat-input-form">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={scope ? 'Ask about this product…' : 'Search the catalog…'}
                aria-label="Message"
                className="chat-input"
                rows={1}
              />
              <button
                type="submit"
                disabled={pending || !input.trim()}
                className="chat-send-button"
                aria-label="Send message"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
