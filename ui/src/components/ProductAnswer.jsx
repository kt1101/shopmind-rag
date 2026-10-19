import { useState } from 'react'
import AnswerText from '../entities/citation/AnswerText.jsx'
import FeedbackWidget from '../features/feedback/FeedbackWidget.jsx'
import { useStaffMode } from '../shared/lib/useStaffMode.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import RagInspector, { sourceLabel } from '../widgets/inspector/RagInspector.jsx'

export function SourceCard({ source }) {
  const { t } = useI18n()
  const experimentalPolicy = source.source === 'policy' && source.metadata?.provenance === 'shopmind_curated_experimental'
  const sourceUrl = /^https?:\/\//i.test(source.source_url || '') ? source.source_url : null
  return <li className="answer-source">
    <div className="source-heading"><span className="source-type">{sourceLabel(t, source.source)}</span>{experimentalPolicy && <span className="experimental-label">{t('answer.experimental')}</span>}<span className="source-score">{t('answer.relevance', { score: Number.isFinite(source.score) ? source.score.toFixed(4) : '—' })}</span></div>
    <strong>{source.title}</strong>
    <small>{source.document_id}{source.policy_version ? ` · ${t('answer.version', { version: source.policy_version })}` : ''}</small>
    {source.metadata?.content_truncated && <p>{t('answer.truncated')}</p>}
    {experimentalPolicy && <p>{t('answer.experimentalNote')}</p>}
    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{t('answer.openSource')}</a>}
  </li>
}

// One question + answer: inline citation chips open the exact evidence; when the answer
// carries an inline trace (explain=true) the RAG Inspector can be toggled open.
export function AnswerTurn({ item, index, productId }) {
  const { t } = useI18n()
  const [showTrace, setShowTrace] = useState(false)
  const staff = useStaffMode()
  const trace = staff.active ? item.trace : null
  const sources = item.sources || []
  return <li className="answer-turn">
    <p className="asked-question"><span>{t('ask.question', { n: index + 1 })}</span>{item.question}</p>
    <AnswerText answer={item.answer} sources={sources} />
    {item.metadata?.missing_sources?.length > 0 && <p className="evidence-warning">{t('answer.missing', { sources: item.metadata.missing_sources.map((s) => sourceLabel(t, s)).join(', ') })}</p>}
    {item.metadata?.truncated_ids?.length > 0 && <p className="evidence-warning">{t('answer.truncated')}</p>}
    {item.insufficient_evidence && <p className="evidence-warning">{t('answer.insufficient')}</p>}
    {sources.length > 0 && <details className="answer-sources"><summary>{t('answer.cited')} ({sources.length})</summary><ol>{sources.map((source) => <SourceCard key={source.citation_id ?? source.document_id} source={source} />)}</ol></details>}
    <div className="answer-tools">
      {trace && (
        <button type="button" className="sm-button sm-button--small" aria-expanded={showTrace} onClick={() => setShowTrace((v) => !v)}>
          <span aria-hidden="true">🔍</span> {showTrace ? t('answer.hideTrace') : t('answer.showTrace')}
        </button>
      )}
      {item.trace_id && <FeedbackWidget target="answer" traceId={item.trace_id} query={item.question} productId={productId} compact />}
    </div>
    {showTrace && trace && <RagInspector trace={trace} compact />}
  </li>
}
