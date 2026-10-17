import { useId, useState } from 'react'
import { Link } from 'react-router'
import { productPath } from '../../lib/urlState.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { citationKey, citationNumber, splitAnswer, unreferencedSources } from './citations.js'
import './citation.css'

function sourceLabel(t, source) {
  const key = `citation.source.${source}`
  const label = t(key)
  return label === key ? source : label
}

export function EvidenceCard({ source, onClose, id }) {
  const { t } = useI18n()
  const experimental = source.source === 'policy' && (source.metadata?.provenance === 'shopmind_curated_experimental' || source.metadata?.experimental)
  const url = /^https?:\/\//i.test(source.url || source.source_url || '') ? (source.url || source.source_url) : null
  return (
    <div className="evidence-card" id={id} role="region" aria-label={t('answer.citation', { id: source.citation_id ?? '' })}>
      <div className="evidence-head">
        <span className={`evidence-source src-${source.source}`}>{sourceLabel(t, source.source)}</span>
        {experimental && <span className="sm-badge sm-badge--warning">{t('answer.experimental')}</span>}
        <strong className="evidence-title">{source.title}</strong>
        {onClose && <button type="button" className="evidence-close" aria-label={t('citation.close')} onClick={onClose}>×</button>}
      </div>
      {source.snippet ? <blockquote className="evidence-snippet">{source.snippet}</blockquote> : <p className="sm-muted sm-small">{source.document_id}</p>}
      <p className="evidence-meta sm-small sm-muted">
        <code>{source.document_id}</code>
        {Number.isFinite(source.score) && <span> · {t('answer.relevance', { score: source.score.toFixed(3) })}</span>}
        {source.metadata?.rating != null && <span> · ★ {source.metadata.rating}</span>}
        {source.product_id && <> · <Link to={productPath(source.product_id)}>{source.product_id}</Link></>}
        {url && <> · <a href={url} target="_blank" rel="noopener noreferrer">{t('answer.openSource')}</a></>}
      </p>
      {experimental && <p className="sm-small sm-muted">{t('answer.experimentalNote')}</p>}
    </div>
  )
}

// Renders an answer with inline citation chips; a chip opens the exact evidence snippet.
// Sources never referenced inline are listed as extra chips unless `showUnreferenced` is false.
export default function AnswerText({ answer, sources = [], className = '', showUnreferenced = true }) {
  const { t } = useI18n()
  const [openId, setOpenId] = useState(null)
  const baseId = useId()
  const segments = splitAnswer(answer, sources)
  const extra = showUnreferenced ? unreferencedSources(answer, sources) : []
  const open = openId ? sources.find((s, i) => citationKey(s, i) === openId) : null

  function chip(id, source, keyPrefix) {
    const n = citationNumber(sources, id)
    const expanded = openId === id
    return (
      <button
        key={`${keyPrefix}-${id}`}
        type="button"
        className={`citation-chip src-${source.source} ${expanded ? 'is-open' : ''}`}
        aria-expanded={expanded}
        aria-controls={`${baseId}-evidence`}
        aria-label={t('citation.open', { id: n ?? id })}
        title={source.title}
        onClick={() => setOpenId(expanded ? null : id)}
      >
        {n ?? id}
      </button>
    )
  }

  return (
    <div className={`answer-with-citations ${className}`}>
      <div className="answer-text">
        {segments.map((seg, i) => (seg.type === 'text' ? <span key={i}>{seg.text}</span> : chip(seg.id, seg.source, i)))}
      </div>
      {extra.length > 0 && (
        <div className="citation-extra" aria-label={t('answer.cited')}>
          <span className="sm-small sm-muted">{t('answer.cited')}:</span>
          {extra.map((s) => chip(citationKey(s, sources.indexOf(s)), s, 'extra'))}
        </div>
      )}
      {open && <EvidenceCard id={`${baseId}-evidence`} source={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}
