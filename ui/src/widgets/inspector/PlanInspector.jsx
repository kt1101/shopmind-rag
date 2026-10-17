import { budgetView, decomposeView, planMethod, retrievalsByNeed } from '../../entities/trace/planTrace.js'
import { traceSummary } from '../../entities/trace/traceModel.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { Waterfall, formatMs, formatScore } from './parts.jsx'
import { CitationAttemptsSection, ContextSection, GenerateSection } from './RagInspector.jsx'
import './inspector.css'

function statusLabel(t, status) {
  const key = `plan.status.${status}`
  const label = t(key)
  return label === key ? status : label
}

// Shopping-planner glass-box: step timeline, decomposition into needs, candidates per need,
// budget decisions, the evidence context and the justification (LLM generate or rules).
export default function PlanInspector({ trace }) {
  const { t } = useI18n()
  if (!trace) return null
  const summary = traceSummary(trace)
  const decompose = decomposeView(trace)
  const retrievals = retrievalsByNeed(trace)
  const budget = budgetView(trace)
  const method = planMethod(trace)

  return (
    <div className="insp-rag insp-plan">
      <p className="insp-rag-meta sm-small sm-muted">
        <span>{t('inspector.pipeline')}: <code>{summary.pipeline}</code></span>
        <span>{t('inspector.duration')}: {formatMs(summary.durationMs)}</span>
        {method && <span>{t('plan.method')}: <code>{method}</code></span>}
        <span>{t('inspector.traceId')}: <code>{summary.traceId}</code></span>
      </p>

      <section>
        <h4 className="insp-h">{t('inspector.steps')}</h4>
        <Waterfall trace={trace} />
      </section>

      {decompose && (
        <section>
          <h4 className="insp-h">{t('plan.trace.decompose')} <span className="sm-muted sm-small">({decompose.impl})</span></h4>
          <dl className="insp-dl insp-dl-grid">
            <div><dt>{t('plan.trace.occasion')}</dt><dd>{decompose.occasion ?? '—'}</dd></div>
            <div><dt>{t('plan.budget')}</dt><dd>{decompose.budget ?? '—'}{decompose.budgetSource ? <span className="sm-muted sm-small"> · {decompose.budgetSource}</span> : null}</dd></div>
          </dl>
          <ol className="insp-plan-needs">
            {decompose.needs.map((n) => (
              <li key={n.id}>
                <code>{n.id}</code> <strong>{n.label}</strong>
                {n.priority && <span className={`sm-badge ${n.priority === 'must' ? 'sm-badge--accent' : ''}`}>{t(`plan.priority.${n.priority}`)}</span>}
                <span className="sm-muted sm-small">{n.query}{n.categories.length ? ` · ${n.categories.join(', ')}` : ` · ${t('plan.trace.noCategory')}`}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {retrievals.length > 0 && (
        <section>
          <h4 className="insp-h">{t('plan.trace.retrieve')}</h4>
          <div className="insp-sources">
            {retrievals.map((r) => (
              <div key={r.needId} className="insp-source">
                <p className="insp-source-head"><code>{r.needId}</code> {r.label} <span className="sm-muted sm-small">{r.impl} · {formatMs(r.durationMs)}</span></p>
                {r.items.length === 0 ? <p className="sm-muted sm-small">{r.summary || t('plan.status.no_match')}</p> : (
                  <ol>
                    {r.items.map((item) => (
                      <li key={item.id}>
                        <span className="insp-cand-title" title={item.id}>#{item.rank ?? '—'} {item.title}</span>
                        <span className="insp-cand-score">{item.price != null ? `$${item.price}` : ''} {formatScore(item.score, 3)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {budget && (
        <section>
          <h4 className="insp-h">{t('plan.trace.budget')} <span className="sm-muted sm-small">({budget.impl})</span></h4>
          <p className="sm-small">{t('plan.total')}: <strong>{budget.total ?? '—'}</strong> / {t('plan.budget')}: <strong>{budget.budget ?? '—'}</strong> {budget.withinBudget === false && <span className="sm-badge sm-badge--danger">{t('plan.overBudgetShort')}</span>}</p>
          <ul className="insp-plan-decisions">
            {budget.decisions.map((d) => (
              <li key={d.needId}>
                <code>{d.needId}</code>
                <span className={`sm-badge ${d.status === 'chosen' ? 'sm-badge--success' : d.status === 'skipped_budget' ? 'sm-badge--warning' : ''}`}>{statusLabel(t, d.status)}</span>
                {d.productId && <code className="sm-small">{d.productId}</code>}
                {d.price != null && <span className="sm-small">${d.price}</span>}
                {d.reason && <span className="sm-muted sm-small">{d.reason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ContextSection trace={trace} />
      <GenerateSection trace={trace} />
      <CitationAttemptsSection trace={trace} />
    </div>
  )
}
