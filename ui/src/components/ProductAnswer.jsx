export function SourceCard({ source }) {
  const experimentalPolicy = source.source === 'policy' && source.metadata?.provenance === 'shopmind_curated_experimental'
  const sourceUrl = /^https?:\/\//i.test(source.source_url || '') ? source.source_url : null
  return <li className="answer-source">
    <div className="source-heading"><span className="source-type">{source.source}</span>{experimentalPolicy && <span className="experimental-label">Experimental policy</span>}<span className="source-score">Relevance {Number.isFinite(source.score) ? source.score.toFixed(4) : '—'}</span></div>
    <strong>{source.title}</strong>
    <small>{source.document_id}{source.policy_version ? ` · version ${source.policy_version}` : ''}{source.metadata?.score_type ? ` · ${source.metadata.score_type} score` : ''}</small>
    {source.metadata?.content_truncated && <p>Evidence excerpt; the full source was not included in the answer context.</p>}
    {experimentalPolicy && <p>Curated for this experiment; not actual store terms.</p>}
    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Open source ↗</a>}
  </li>
}

export function AnswerTurn({ item, index }) {
  const sources = item.sources || []
  return <li className="answer-turn">
    <p className="asked-question"><span>Question {index + 1}</span>{item.question}</p>
    <div className="answer-text">{item.answer}</div>
    {item.metadata?.missing_sources?.length > 0 && <p className="evidence-warning">No usable evidence for: {item.metadata.missing_sources.join(', ')}.</p>}
    {item.metadata?.truncated_ids?.length > 0 && <p className="evidence-warning">Some evidence was shortened to excerpts.</p>}
    {item.insufficient_evidence && <p className="evidence-warning">The indexed sources did not provide enough evidence for a reliable answer.</p>}
    {sources.length > 0 && <div className="answer-sources"><h3>Cited sources</h3><ol>{sources.map((source) => <SourceCard key={source.document_id} source={source} />)}</ol></div>}
  </li>
}
