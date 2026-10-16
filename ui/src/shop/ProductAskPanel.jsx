import { useEffect, useRef, useState } from 'react'
import { askProduct } from '../api.js'
import { AnswerTurn } from '../components/ProductAnswer.jsx'

const OPTIONAL_SOURCES = [
  { value: 'review', label: 'Reviews' },
  { value: 'policy', label: 'Experimental policies' },
]

// Mount with key={product.product_id} so the conversation resets per product.
export default function ProductAskPanel({ product }) {
  const [question, setQuestion] = useState('')
  const [extraSources, setExtraSources] = useState([])
  const [answers, setAnswers] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [lastAsk, setLastAsk] = useState(null)
  const controller = useRef(null)

  useEffect(() => () => controller.current?.abort(), [])

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
        signal: requestController.signal,
      })
      if (controller.current !== requestController) return
      setAnswers((current) => [...current, { question: text, ...data }])
      setQuestion('')
      setStatus('idle')
    } catch (err) {
      if (controller.current !== requestController || err.name === 'AbortError') return
      setError(err.message)
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
    setExtraSources((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  }

  const loading = status === 'loading'

  return (
    <section className="product-ask" aria-labelledby="product-ask-title">
      <div className="product-ask-head">
        <p className="product-ask-kicker">AI answers · grounded in evidence</p>
        <h2 id="product-ask-title">Ask about this product</h2>
        <p>ShopMind retrieves evidence for this product and answers only from what it finds, citing every source.</p>
      </div>

      {answers.length > 0 && (
        <ol className="answer-history" aria-label="Questions and answers" aria-live="polite">
          {answers.map((item, index) => <AnswerTurn key={index} item={item} index={index} />)}
        </ol>
      )}

      <form className="ask-form" onSubmit={submit}>
        <label htmlFor="product-ask-question">{answers.length ? 'Ask another question' : 'Your question'}</label>
        <textarea
          id="product-ask-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Is it waterproof? What do reviews say about the fit?"
          rows="3"
          maxLength="2000"
        />
        <fieldset className="ask-source-options" disabled={loading}>
          <legend>Evidence sources</legend>
          <span className="source-required">Product details included</span>
          {OPTIONAL_SOURCES.map((option) => (
            <label key={option.value}>
              <input type="checkbox" checked={extraSources.includes(option.value)} onChange={() => toggleSource(option.value)} />
              {option.label}
            </label>
          ))}
        </fieldset>
        <div className="ask-form-footer">
          <span>Each question is answered on its own. Relevance ranks sources; it isn't answer confidence.</span>
          <button type="submit" disabled={!question.trim() || loading}>{loading ? 'Finding evidence…' : 'Ask'}</button>
        </div>
      </form>

      {loading && <p className="ask-status" role="status">Finding evidence and composing an answer…</p>}
      {error && (
        <p className="ask-error" role="alert">
          {error}
          {lastAsk && <button type="button" onClick={() => ask(lastAsk)}>Retry</button>}
        </p>
      )}
    </section>
  )
}
