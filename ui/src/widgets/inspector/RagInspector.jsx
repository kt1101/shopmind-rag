import { candidatesBySource, citationAttempts, contextView, generateView, rewriteView } from '../../entities/trace/ragTrace.js'
import { traceSummary } from '../../entities/trace/traceModel.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { JsonBlock, Waterfall, formatMs, formatScore } from './parts.jsx'
import './inspector.css'

function sourceLabel(t, source) {
  const key = `citation.source.${source}`
  const label = t(key)
  return label === key ? source : label
}

// Inline RAG glass-box: step timeline, rewrite/intent, candidates per source, the context
// actually sent, generation details and citation validation attempts.
export default function RagInspector({ trace, compact = false }) {
  const { t } = useI18n()
  if (!trace) return null
  const summary = traceSummary(trace)
  const rewrite = rewriteView(trace)
  const groups = candidatesBySource(trace)
  const context = contextView(trace)
  const gen = generateView(trace)
  const attempts = citationAttempts(trace)

  return (
    <div className={`insp-rag ${compact ? 'is-compact' : ''}`}>
      <p className="insp-rag-meta sm-small sm-muted">
        <span>{t('inspector.pipeline')}: <code>{summary.pipeline}</code></span>
        <span>{t('inspector.duration')}: {formatMs(summary.durationMs)}</span>
        <span>{t('inspector.traceId')}: <code>{summary.traceId}</code></span>
      </p>

      <section>
        <h4 className="insp-h">{t('inspector.steps')}</h4>
        <Waterfall trace={trace} />
      </section>

      {rewrite && (
        <section>
          <dl className="insp-dl">
            {rewrite.standalone && <div><dt>{t('inspector.standalone')}</dt><dd>{rewrite.standalone}</dd></div>}
            {rewrite.intent && <div><dt>{t('inspector.intent')}</dt><dd><span className="sm-badge sm-badge--accent">{rewrite.intent}</span> <span className="sm-muted">{rewrite.intentReason}</span></dd></div>}
          </dl>
        </section>
      )}

      {groups.length > 0 && (
        <section>
          <h4 className="insp-h">{t('inspector.candidates')}</h4>
          <div className="insp-sources">
            {groups.map((group) => (
              <div key={group.source} className="insp-source">
                <p className="insp-source-head"><span className={`insp-source-badge src-${group.source}`}>{sourceLabel(t, group.source)}</span> <span className="sm-muted">{group.items.length}</span></p>
                <ol>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <span className="insp-cand-title" title={item.id}>#{item.rank ?? '—'} {item.title}</span>
                      <span className="insp-cand-score">{formatScore(item.score, 3)}</span>
                      {item.snippet && <span className="insp-cand-snippet">{item.snippet}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {context && (
        <section>
          <h4 className="insp-h">{t('inspector.context')}</h4>
          {context.budget && (
            <div className="insp-budget" role="meter" aria-valuemin={0} aria-valuemax={context.budget} aria-valuenow={context.renderedChars} aria-label={t('inspector.budget', { used: context.renderedChars, budget: context.budget })}>
              <span style={{ width: `${context.usedPct}%` }} />
              <small>{t('inspector.budget', { used: context.renderedChars, budget: context.budget })}</small>
            </div>
          )}
          <ul className="insp-context">
            {context.documents.map((doc) => (
              <li key={doc.id} className={doc.included ? 'is-in' : 'is-out'}>
                <span className={`sm-badge ${doc.included ? 'sm-badge--success' : 'sm-badge--warning'}`}>{doc.included ? t('inspector.included') : t('inspector.excluded')}</span>
                <span className={`insp-source-badge src-${doc.source}`}>{sourceLabel(t, doc.source)}</span>
                <span className="insp-context-title" title={doc.id}>{doc.title}</span>
                <span className="sm-muted sm-small">{doc.chars} chars</span>
                {!doc.included && doc.reason && <span className="sm-small insp-reason">{t(`inspector.reason.${doc.reason}`) === `inspector.reason.${doc.reason}` ? doc.reason : t(`inspector.reason.${doc.reason}`)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {gen && (
        <section>
          <h4 className="insp-h">{t('inspector.generate')}</h4>
          <dl className="insp-dl insp-dl-grid">
            <div><dt>{t('inspector.model')}</dt><dd><code>{gen.model ?? '—'}</code></dd></div>
            <div><dt>{t('inspector.prompt')}</dt><dd><code>{gen.promptId ?? '—'}{gen.promptVersion ? `@${gen.promptVersion}` : ''}</code></dd></div>
            <div><dt>{t('inspector.attempt')}</dt><dd>{gen.attempt ?? '—'}</dd></div>
            <div><dt>{t('inspector.usage')}</dt><dd>{gen.inputTokens ?? '—'} / {gen.outputTokens ?? '—'}</dd></div>
          </dl>
          {gen.rawOutput && !compact && (
            <details className="insp-raw">
              <summary>{t('inspector.rawOutput')}</summary>
              <JsonBlock value={gen.rawOutput} label={t('inspector.rawOutput')} />
            </details>
          )}
        </section>
      )}

      {attempts.length > 0 && (
        <section>
          <h4 className="insp-h">{t('inspector.citations')}</h4>
          <ol className="insp-attempts">
            {attempts.map((a) => (
              <li key={a.attempt} className={a.valid ? 'is-valid' : 'is-invalid'}>
                <span className={`sm-badge ${a.valid ? 'sm-badge--success' : 'sm-badge--danger'}`}>{t('inspector.attempt')} {a.attempt}: {a.valid ? t('inspector.valid') : t('inspector.invalid')}</span>
                {a.error && <span className="sm-small">{a.error}</span>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
