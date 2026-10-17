import { useEffect, useRef, useState } from 'react'
import { askProduct } from '../api.js'
import { AnswerTurn } from '../components/ProductAnswer.jsx'
import { readJSON, writeJSON } from '../shared/lib/storage.js'
import { explainFor } from '../shared/lib/staffMode.js'
import { useStaffMode } from '../shared/lib/useStaffMode.js'
import { describeError } from '../shared/api/errors.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import '../entities/citation/citation.css'

const EXPLAIN_KEY = 'shopmind.explain'
const SUGGESTED = {
  vi: ['Có chống nước không?', 'Chất liệu là gì?', 'Review nói gì về size?', 'Đổi trả thế nào?'],
  en: ['Is it waterproof?', 'What material is it?', 'What do reviews say about the fit?', 'What is the return policy?'],
}

function AskError({ error, onRetry }) {
  const { t } = useI18n()
  const info = describeError(error, t)
  return (
    <div className={`ask-error ask-error--${info.kind}`} role="alert">
      <p>
        <strong>{info.title}.</strong> {info.message}
      </p>
      {onRetry && info.retryable && <button type="button" onClick={onRetry}>{t('state.retry')}</button>}
    </div>
  )
}

// Mount with key={product.product_id} so the conversation resets per product.
export default function ProductAskPanel({ product }) {
  const { t, lang } = useI18n()
  const [question, setQuestion] = useState('')
  const [extraSources, setExtraSources] = useState([])
  const [answers, setAnswers] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [lastAsk, setLastAsk] = useState(null)
  const [explain, setExplain] = useState(() => readJSON(EXPLAIN_KEY, true) !== false)
  const staff = useStaffMode()
  const controller = useRef(null)

  useEffect(() => () => controller.current?.abort(), [])

  function toggleExplain() {
    setExplain((value) => {
      writeJSON(EXPLAIN_KEY, !value)
      return !value
    })
  }

  async function ask({ text, sources }) {
    controller.current?.abort()
    const requestController = new AbortController()
    controller.current = requestController
    setStatus('loading')
    setError(null)
    setLastAsk({ text, sources })
    try {
      const { data } = await askProduct({
        question: text,
        productId: product.product_id,
        sources,
        debug: true,
        explain: explainFor(staff, explain),
        signal: requestController.signal,
      })
      if (controller.current !== requestController) return
      setAnswers((current) => [...current, { question: text, ...data }])
      setQuestion('')
      setStatus('idle')
    } catch (err) {
      if (controller.current !== requestController || err.name === 'AbortError') return
      setError(err)
      setStatus('idle')
    }
  }

  function submit(event) {
    event.preventDefault()
    const text = question.trim()
    if (!text || status === 'loading') return
    ask({ text, sources: ['product', ...extraSources] })
  }

  function toggleSource(value) {
    setExtraSources((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]))
  }

  const loading = status === 'loading'
  const optional = [{ value: 'review', label: t('ask.reviews') }, { value: 'policy', label: t('ask.policies') }]

  return (
    <section className="product-ask" aria-labelledby="product-ask-title">
      <div className="product-ask-head">
        <p className="product-ask-kicker">{t('ask.kicker')}</p>
        <h2 id="product-ask-title">{t('ask.title')}</h2>
        <p>{t('ask.intro')}</p>
        {staff.active && (
          <label className="product-ask-explain" title={t('chat.explainHint')}>
            <input type="checkbox" checked={explain} onChange={toggleExplain} />
            {t('chat.explain')} <span className="sm-muted sm-small">(explain=true)</span>
          </label>
        )}
      </div>

      {answers.length > 0 && (
        <ol className="answer-history" aria-label={t('ask.title')} aria-live="polite">
          {answers.map((item, index) => <AnswerTurn key={index} item={item} index={index} productId={product.product_id} />)}
        </ol>
      )}

      {answers.length === 0 && (
        <div className="product-ask-suggested" role="group" aria-label={t('ask.suggested')}>
          {(SUGGESTED[lang] || SUGGESTED.vi).map((text) => (
            <button key={text} type="button" className="chat-suggestion-chip" disabled={loading} onClick={() => {
              const sources = /đổi trả|return/i.test(text) ? ['product', 'policy'] : /review/i.test(text) ? ['product', 'review'] : ['product', ...extraSources]
              ask({ text, sources })
            }}>{text}</button>
          ))}
        </div>
      )}

      <form className="ask-form" onSubmit={submit}>
        <label htmlFor="product-ask-question">{answers.length ? t('ask.another') : t('ask.yours')}</label>
        <textarea
          id="product-ask-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t('ask.placeholder')}
          rows="3"
          maxLength="2000"
        />
        <fieldset className="ask-source-options" disabled={loading}>
          <legend>{t('ask.sources')}</legend>
          <span className="source-required">{t('ask.productIncluded')}</span>
          {optional.map((option) => (
            <label key={option.value}>
              <input type="checkbox" checked={extraSources.includes(option.value)} onChange={() => toggleSource(option.value)} />
              {option.label}
            </label>
          ))}
        </fieldset>
        <div className="ask-form-footer">
          <span>{t('ask.footer')}</span>
          <button type="submit" disabled={!question.trim() || loading}>{loading ? t('ask.loading') : t('ask.submit')}</button>
        </div>
      </form>

      {loading && <p className="ask-status" role="status">{t('ask.loadingLong')}</p>}
      {error && <AskError error={error} onRetry={lastAsk ? () => ask(lastAsk) : null} />}
    </section>
  )
}
