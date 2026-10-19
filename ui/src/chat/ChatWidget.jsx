import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useChat } from './ChatProvider.jsx'
import { planHref, progressItems, sourceCount } from './chatReply.js'
import { resolveImageUrl, uploadChatImage } from '../api.js'
import { formatPrice } from '../lib/format.js'
import { productPath } from '../lib/urlState.js'
import { displayTitle } from '../entities/product/product.js'
import AnswerText from '../entities/citation/AnswerText.jsx'
import FeedbackWidget from '../features/feedback/FeedbackWidget.jsx'
import { describeError } from '../shared/api/errors.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import InspectorDrawer from '../widgets/inspector/InspectorDrawer.jsx'
import RagInspector from '../widgets/inspector/RagInspector.jsx'
import '../entities/citation/citation.css'
import './chat.css'

const SUGGESTIONS = {
  vi: { catalog: ['Ba lô đen chống nước', 'Giày bốt da màu nâu', 'Chuẩn bị đi biển 5 ngày, ngân sách 300$', 'Chính sách đổi trả thế nào?'], product: ['Chất liệu là gì?', 'Có chống nước không?', 'Nặng bao nhiêu?'] },
  en: { catalog: ['Black waterproof backpack', 'Brown leather boots', 'Beach trip for 5 days, budget $300', 'What is the return policy?'], product: ['What material is it made of?', 'Is it waterproof?', 'How much does it weigh?'] },
}

function isImageFile(file) {
  return Boolean(file?.type?.startsWith('image/')) || (!file?.type && /\.(jpe?g|png|webp|gif|avif)$/i.test(file?.name || ''))
}

function ChatEvidence({ evidence }) {
  const { t } = useI18n()
  const missing = evidence?.metadata?.missing_sources ?? []
  return (
    <>
      {evidence?.insufficient_evidence && <p className="chat-evidence-warning">{t('answer.insufficient')}</p>}
      {missing.length > 0 && <p className="chat-evidence-warning">{t('answer.missing', { sources: missing.join(', ') })}</p>}
      {evidence?.metadata?.truncated_ids?.length > 0 && <p className="chat-evidence-warning">{t('answer.truncated')}</p>}
    </>
  )
}

function ChatProductCard({ product, onAsk }) {
  const { t } = useI18n()
  const [broken, setBroken] = useState(false)
  const image = resolveImageUrl(product?.image_url)
  const title = displayTitle(product?.title) || t('chat.productFallback')
  return (
    <div className="chat-source">
      <Link to={productPath(product?.product_id)} className="chat-source-card">
        <div className="chat-source-thumb">
          {image && !broken ? <img src={image} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span aria-hidden="true" className="chat-source-placeholder">◇</span>}
        </div>
        <span className="chat-source-title">{title}</span>
      </Link>
      <button type="button" className="chat-source-ask" onClick={() => onAsk(product)} aria-label={`${t('chat.askAbout')}: ${title}`}>{t('chat.askAbout')}</button>
    </div>
  )
}

function ProductCards({ products, onAsk }) {
  if (!Array.isArray(products) || !products.length) return null
  return (
    <div className="chat-sources">
      {products.map((p, i) => <ChatProductCard key={p.product_id || i} product={p} onAsk={onAsk} />)}
    </div>
  )
}

// intent=shopping_plan: what each need got, the total vs budget and a link to the full planner.
function PlanSummary({ plan, message }) {
  const { t } = useI18n()
  if (!plan) return null
  const money = (n) => formatPrice({ amount: n, currency: 'USD' }) ?? `${n} USD`
  return (
    <div className="chat-plan">
      <ul className="chat-plan-needs">
        {plan.needs.map((need, i) => (
          <li key={`${need.label}-${i}`} className={`is-${need.status}`}>
            <span className="chat-plan-mark" aria-hidden="true">{need.status === 'chosen' ? '✓' : need.status === 'skipped_budget' ? '–' : '×'}</span>
            <span className="chat-plan-label">{need.label}</span>
            {need.status !== 'chosen' && <span className="chat-plan-status">{t(`plan.status.${need.status}`)}</span>}
          </li>
        ))}
      </ul>
      {plan.total != null && (
        <p className={`chat-plan-total ${plan.withinBudget ? '' : 'is-over'}`}>
          {t('plan.total')}: <strong>{money(plan.total)}</strong>{plan.budget != null ? ` / ${t('plan.budget')} ${money(plan.budget)}` : ''}
        </p>
      )}
      {message && <Link to={planHref(message)} className="chat-plan-link">{t('chat.openPlan')} →</Link>}
    </div>
  )
}

// Failed reply in plain words: an LLM that is switched off is not a connection problem, and
// retrying cannot help, so it points at what still works instead.
function ChatError({ msg, onRetry }) {
  const { t } = useI18n()
  const info = describeError({ ...msg.error, message: msg.content }, t)
  return (
    <div className="chat-message chat-message--error">
      <div className={`chat-bubble chat-bubble--error chat-error--${info.kind}`}>
        <p className="chat-bubble-text"><strong>{info.title}</strong></p>
        <p className="chat-error-detail">{info.message}</p>
        {info.kind === 'llm_unavailable' ? (
          <p className="chat-error-links">
            <Link to="/plan">{t('error.tryPlan')}</Link>
          </p>
        ) : info.retryable ? (
          <button type="button" className="chat-retry-button" onClick={onRetry}>{t('chat.retry')}</button>
        ) : null}
      </div>
    </div>
  )
}

function IntentBadge({ intent }) {
  const { t } = useI18n()
  if (!intent) return null
  return <span className={`chat-intent intent-${intent}`}>{t('chat.intent', { intent: t(`intent.${intent}`) })}</span>
}

function Progress({ steps }) {
  const { t } = useI18n()
  const items = progressItems(steps)
  if (!items.length) return null
  return (
    <ol className="chat-progress" aria-label={t('a11y.progress')}>
      {items.map((item, i) => {
        const n = item.step === 'multi_source_retrieve' ? sourceCount(item.summary) : null
        const label = item.step === 'multi_source_retrieve' && !n ? t('step.multi_source_retrieveAny') : t(`step.${item.step}`, { n })
        return (
          <li key={`${item.step}-${i}`} className={`chat-progress-item is-${item.status}`}>
            {i > 0 && <span className="chat-progress-arrow" aria-hidden="true">→</span>}
            <span>{label === `step.${item.step}` ? item.step : label}</span>
            {item.status === 'done' ? <span className="chat-progress-check" role="img" aria-label={t('a11y.done')}>✓</span> : <span className="chat-progress-spinner" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

function AssistantMessage({ msg, onAsk, onInspect, staff }) {
  const { t } = useI18n()
  const [showTrace, setShowTrace] = useState(false)
  const isSearchAnswer = msg.kind === 'search' || msg.intent === 'product_search'
  const products = msg.kind === 'search' ? msg.sources : msg.products
  const citations = msg.kind === 'search' ? [] : msg.sources || []
  return (
    <div className="chat-message chat-message--assistant">
      <div className="chat-bubble chat-bubble--assistant">
        {(msg.intent || msg.standalone) && (
          <div className="chat-meta">
            <IntentBadge intent={msg.intent} />
            {msg.standalone && <span className="chat-standalone" title={msg.standalone}>{t('chat.standalone', { text: msg.standalone })}</span>}
          </div>
        )}
        {citations.length ? <AnswerText answer={msg.content} sources={citations} className="chat-bubble-text" /> : <p className="chat-bubble-text">{msg.content}</p>}
        {msg.kind !== 'search' && msg.evidence && msg.intent !== 'shopping_plan' && <ChatEvidence evidence={msg.evidence} />}
        {msg.intent === 'shopping_plan' && <PlanSummary plan={msg.plan} message={msg.question} />}
        <ProductCards products={products} onAsk={onAsk} />
        {((staff && msg.trace) || msg.traceId) && (
          <div className="chat-tools">
            {staff && msg.trace && (isSearchAnswer ? (
              <button type="button" className="chat-tool-button" onClick={() => onInspect(msg)}>🔍 {t('results.why')}</button>
            ) : (
              <button type="button" className="chat-tool-button" aria-expanded={showTrace} onClick={() => setShowTrace((v) => !v)}>
                🔍 {showTrace ? t('answer.hideTrace') : t('answer.showTrace')}
              </button>
            ))}
            {msg.traceId && <FeedbackWidget target={isSearchAnswer ? 'search' : 'answer'} traceId={msg.traceId} query={msg.question} compact />}
          </div>
        )}
        {staff && showTrace && msg.trace && <RagInspector trace={msg.trace} compact />}
      </div>
    </div>
  )
}

export default function ChatWidget() {
  const { open, pending, messages, scope, live, explain, staff, openChat, closeChat, send, retry, setScope, newChat, setExplain } = useChat()
  const { t, lang } = useI18n()
  const [input, setInput] = useState('')
  const [attachment, setAttachment] = useState(null) // {token, url, name} | {uploading: true} | {error}
  const [inspected, setInspected] = useState(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const messagesEndRef = useRef(null)
  const launcherRef = useRef(null)
  const wasOpen = useRef(open)

  // Focus moves into the panel on open and back to the launcher on close (Escape or ×).
  useEffect(() => {
    if (open) inputRef.current?.focus()
    else if (wasOpen.current) launcherRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (!open || inspected) return undefined
    function handleKeyDown(e) {
      if (e.key === 'Escape') closeChat()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, closeChat, inspected])

  // Keep the newest message in view. Streaming tokens scroll instantly (smooth scrolling on
  // every token stutters and fights the user); new messages scroll smoothly.
  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [open, messages, pending])
  useEffect(() => {
    if (open && live) messagesEndRef.current?.scrollIntoView?.({ block: 'end' })
  }, [open, live])

  async function attach(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isImageFile(file)) {
      setAttachment({ error: t('search.badFile') })
      return
    }
    let url = null
    try {
      url = URL.createObjectURL(file)
    } catch {
      url = null
    }
    setAttachment({ uploading: true, url, name: file.name })
    try {
      const { data } = await uploadChatImage({ file })
      setAttachment({ token: data.image_token, url, name: file.name })
    } catch (err) {
      setAttachment({ error: err?.message || t('chat.uploadFailed') })
    }
  }

  function handleSend() {
    const trimmed = input.trim()
    const image = attachment?.token ? { token: attachment.token, url: attachment.url, name: attachment.name } : null
    if ((!trimmed && !image) || pending || attachment?.uploading) return
    send(trimmed, image)
    setInput('')
    setAttachment(null)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const suggestions = (SUGGESTIONS[lang] || SUGGESTIONS.vi)[scope ? 'product' : 'catalog']
  const canSend = (input.trim() || attachment?.token) && !pending && !attachment?.uploading

  return (
    <>
      <button ref={launcherRef} type="button" className={`chat-launcher ${open ? 'chat-launcher--hidden' : ''}`} aria-label={t('chat.open')} aria-expanded={open} onClick={openChat}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {open && (
        <div role="dialog" aria-label={t('chat.title')} className="chat-panel">
          <div className="chat-header">
            <div className="chat-header-info">
              <h2 className="chat-title">{t('chat.title')}</h2>
              <p className="chat-subtitle">{scope ? t('chat.subtitleScoped') : t('chat.subtitle')}</p>
            </div>
            {staff && (
              <label className="chat-explain" title={t('chat.explainHint')}>
                <input type="checkbox" checked={explain} onChange={(e) => setExplain(e.target.checked)} />
                <span>{t('chat.explain')}</span>
              </label>
            )}
            <button type="button" className="chat-icon-button" aria-label={t('chat.newChat')} title={t('chat.newChat')} onClick={newChat} disabled={pending}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button type="button" className="chat-close-button" aria-label={t('chat.close')} onClick={closeChat}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {scope && (
            <div className="chat-scope">
              <span>{t('chat.askingAbout')} <strong>{displayTitle(scope.title)}</strong></span>
              <button type="button" aria-label={t('chat.stopScope')} onClick={() => setScope(null)}>×</button>
            </div>
          )}

          <div className="chat-messages" role="log" aria-live="polite" aria-relevant="additions" aria-busy={pending}>
            {messages.length === 0 && (
              <div className="chat-empty-state">
                <p className="chat-greeting">{scope ? t('chat.greetingScoped', { title: scope.title }) : t('chat.greeting')}</p>
                <div className="chat-suggestions">
                  {suggestions.map((chipText) => (
                    <button key={chipText} type="button" className="chat-suggestion-chip" onClick={() => send(chipText)}>{chipText}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="chat-message chat-message--user">
                    <div className="chat-bubble chat-bubble--user">
                      {msg.image?.url && <img className="chat-user-image" src={msg.image.url} alt={t('chat.imageAlt')} />}
                      {msg.content && <p className="chat-bubble-text">{msg.content}</p>}
                    </div>
                  </div>
                )
              }
              if (msg.role === 'scope') {
                return <p key={msg.id} className="chat-scope-divider">{msg.product ? t('chat.nowAbout', { title: msg.product.title }) : t('chat.backToCatalog')}</p>
              }
              if (msg.role === 'error') {
                return <ChatError key={msg.id} msg={msg} onRetry={retry} />
              }
              return <AssistantMessage key={msg.id} msg={msg} onAsk={setScope} onInspect={setInspected} staff={staff} />
            })}

            {pending && (
              <div className="chat-message chat-message--assistant chat-message--pending" aria-label={t('chat.typing')}>
                <div className="chat-bubble chat-bubble--assistant">
                  {live?.intent && <div className="chat-meta"><IntentBadge intent={live.intent} /></div>}
                  <Progress steps={live?.steps || []} />
                  {live?.text ? <p className="chat-bubble-text">{live.text}<span className="chat-caret" aria-hidden="true" /></p> : (
                    <div className="chat-typing-indicator"><span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" /></div>
                  )}
                  <ProductCards products={live?.products} onAsk={setScope} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} tabIndex={-1} aria-hidden="true" />
          </div>

          <div className="chat-input-area">
            {attachment && (
              <div className={`chat-attachment ${attachment.error ? 'is-error' : ''}`}>
                {attachment.url && <img src={attachment.url} alt={t('chat.imageAlt')} />}
                <span className="chat-attachment-text" role={attachment.error ? 'alert' : 'status'}>
                  {attachment.error || (attachment.uploading ? t('chat.uploading') : attachment.name)}
                </span>
                <button type="button" aria-label={t('chat.removeImage')} onClick={() => setAttachment(null)}>×</button>
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); handleSend() }} className="chat-input-form">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={attach} tabIndex={-1} aria-hidden="true" />
              <button type="button" className="chat-attach-button" aria-label={t('chat.attach')} title={t('chat.attach')} onClick={() => fileRef.current?.click()} disabled={pending}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />
                </svg>
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={scope ? t('chat.placeholderScoped') : t('chat.placeholder')}
                aria-label={t('chat.placeholder')}
                className="chat-input"
                rows={1}
              />
              <button type="submit" disabled={!canSend} className="chat-send-button" aria-label={t('chat.send')}>{t('chat.send')}</button>
            </form>
          </div>
        </div>
      )}

      {staff && <InspectorDrawer open={Boolean(inspected)} onClose={() => setInspected(null)} trace={inspected?.trace} view="search" />}
    </>
  )
}
