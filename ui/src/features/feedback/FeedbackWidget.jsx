import { useEffect, useId, useReducer } from 'react'
import { sendFeedback } from '../../api.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { useToast } from '../../shared/ui/Toast.jsx'
import { RATINGS, buildFeedback, feedbackReducer, initialFeedback } from './feedback.js'
import './feedback.css'

// 👍/👎 with an optional comment. target: 'search' (results page) | 'answer' (RAG answer).
export default function FeedbackWidget({ target, traceId, query, productId, compact = false }) {
  const { t } = useI18n()
  const { toast } = useToast()
  const [state, dispatch] = useReducer(feedbackReducer, initialFeedback)
  const commentId = useId()

  // A new search/answer resets the widget.
  useEffect(() => {
    dispatch({ type: 'reset' })
  }, [traceId])

  async function submit(rating, comment) {
    const payload = buildFeedback({ target, traceId, rating, query, productId, comment })
    if (!payload) return
    dispatch({ type: 'send' })
    try {
      await sendFeedback(payload)
      dispatch({ type: 'sent' })
      toast(t('feedback.thanks'), { tone: 'success' })
    } catch (error) {
      dispatch({ type: 'error', error })
      toast(t('feedback.failed'), { tone: 'error' })
    }
  }

  if (!traceId) return null
  if (state.status === 'sent') {
    return <p className={`fb fb--done ${compact ? 'fb--compact' : ''}`} role="status">{t('feedback.thanks')}</p>
  }

  const sending = state.status === 'sending'
  return (
    <div className={`fb ${compact ? 'fb--compact' : ''}`}>
      <span className="fb-question">{t(`feedback.question.${target}`)}</span>
      <span className="fb-buttons" role="group" aria-label={t(`feedback.question.${target}`)}>
        {[['up', '👍', t('feedback.up')], ['down', '👎', t('feedback.down')]].map(([key, emoji, label]) => (
          <button
            key={key}
            type="button"
            className="fb-btn"
            aria-pressed={state.rating === RATINGS[key]}
            aria-label={label}
            title={label}
            disabled={sending}
            onClick={() => dispatch({ type: 'rate', rating: RATINGS[key] })}
          >
            <span aria-hidden="true">{emoji}</span>
          </button>
        ))}
      </span>
      {(state.status === 'rated' || state.status === 'sending' || state.status === 'error') && (
        <form className="fb-form" onSubmit={(e) => { e.preventDefault(); submit(state.rating, state.comment) }}>
          <label htmlFor={commentId} className="sr-only">{t('feedback.comment')}</label>
          <input
            id={commentId}
            type="text"
            value={state.comment}
            maxLength={500}
            placeholder={t('feedback.comment')}
            onChange={(e) => dispatch({ type: 'comment', comment: e.target.value })}
            disabled={sending}
          />
          <button type="submit" className="sm-button sm-button--primary sm-button--small" disabled={sending}>{t('feedback.send')}</button>
          <button type="button" className="sm-button sm-button--ghost sm-button--small" disabled={sending} onClick={() => submit(state.rating, '')}>{t('feedback.skip')}</button>
        </form>
      )}
    </div>
  )
}
