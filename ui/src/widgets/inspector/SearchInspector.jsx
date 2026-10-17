import { useMemo, useState } from 'react'
import {
  composeView, fuseK, highlightSegments, matchedTermsView, queryDslView, queryView, rankingTable, rrfBreakdown,
} from '../../entities/trace/searchTrace.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import Tabs from '../../shared/ui/Tabs.jsx'
import RankMovementChart, { columnLabel } from './RankMovementChart.jsx'
import { JsonBlock, Waterfall, formatScore } from './parts.jsx'

function Highlighted({ text, terms }) {
  return highlightSegments(text, terms).map((seg, i) => (seg.match ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>))
}

function QueryTab({ trace }) {
  const { t } = useI18n()
  const q = queryView(trace)
  return (
    <div className="insp-stack">
      <dl className="insp-dl">
        <div><dt>{t('inspector.original')}</dt><dd>{q.original ? <q>{q.original}</q> : '—'}</dd></div>
        <div><dt>{t('inspector.language')}</dt><dd>{q.language ? <span className="sm-badge">{q.language}</span> : '—'}</dd></div>
        <div>
          <dt>{t('inspector.normalized')}</dt>
          <dd>{q.normalized ? <span className="insp-tokens">{q.normalized.split(/\s+/).map((tok, i) => <code key={`${tok}-${i}`}>{tok}</code>)}</span> : '—'}</dd>
        </div>
        {q.mode && <div><dt>mode</dt><dd><code>{q.mode}</code></dd></div>}
      </dl>

      <section>
        <h3 className="insp-h">{t('inspector.aliases')}</h3>
        {q.aliases.length ? (
          <ul className="insp-aliases">
            {q.aliases.map((a, i) => (
              <li key={i}><q>{a.from}</q> <span aria-hidden="true">→</span> <span className="sm-badge sm-badge--accent">{a.kind}: {a.to}</span></li>
            ))}
          </ul>
        ) : <p className="sm-muted">{t('inspector.noAliases')}</p>}
      </section>

      {q.adaptive && (
        <section>
          <h3 className="insp-h">{t('inspector.adaptive')}</h3>
          <p><span className="sm-badge sm-badge--accent">{q.adaptive.mode}</span> <span className="sm-muted">{q.adaptive.reason}</span></p>
        </section>
      )}

      <section>
        <h3 className="insp-h">{t('inspector.filters')}</h3>
        {q.filters.length ? (
          <div className="insp-table-wrap">
            <table className="insp-table">
              <thead><tr><th scope="col">field</th><th scope="col">{t('inspector.requested')}</th><th scope="col">{t('inspector.resolved')}</th><th scope="col">match</th></tr></thead>
              <tbody>
                {q.filters.map((f) => (
                  <tr key={f.field}>
                    <th scope="row"><code>{f.field}</code></th>
                    <td>{f.requested.join(', ') || '—'}</td>
                    <td>{f.resolved.join(', ') || '—'}</td>
                    <td>
                      {f.match && <span className={`sm-badge ${f.match === 'exact' ? 'sm-badge--success' : 'sm-badge--warning'}`}>{t(`inspector.match.${f.match}`)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="sm-muted">{t('inspector.noFilters')}</p>}
      </section>

      {q.dense.length > 0 && (
        <section>
          <h3 className="insp-h">{t('inspector.embedder')}</h3>
          <ul className="insp-list">
            {q.dense.map((d) => (
              <li key={d.id}>
                <strong>{d.id}</strong> <code>{d.field}</code> · {d.embedder}
                {d.dims != null && <span className="sm-muted"> · {t('inspector.vector', { dims: d.dims, norm: d.norm ?? '—' })}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {q.notes.length > 0 && (
        <section>
          <h3 className="insp-h">{t('inspector.notes')}</h3>
          <ul className="insp-list">
            {q.notes.map((n, i) => <li key={i}><code>{n.step}</code> {n.note}</li>)}
          </ul>
        </section>
      )}
    </div>
  )
}

function RankCell({ row, column }) {
  const rank = row.ranks[column.id]
  if (!Number.isFinite(rank)) return <td className="num sm-muted">—</td>
  let movement = null
  if (column.kind === 'final') {
    const before = row.rerank?.before ?? row.ranks.fuse
    if (Number.isFinite(before) && before !== rank) {
      const up = before > rank
      movement = <span className={`insp-move ${up ? 'up' : 'down'}`} aria-label={up ? `up ${before - rank}` : `down ${rank - before}`}>{up ? '▲' : '▼'}{Math.abs(before - rank)}</span>
    }
  }
  return <td className="num">#{rank}{movement}</td>
}

function RankingTab({ trace, titles }) {
  const { t } = useI18n()
  const table = useMemo(() => rankingTable(trace, { titles }), [trace, titles])
  const [selectedId, setSelectedId] = useState(() => table.rows[0]?.id ?? null)
  const selected = table.rows.find((r) => r.id === selectedId) || null
  const fuseStep = (trace?.steps || []).find((step) => step.step === 'fuse')
  const fuseImpl = fuseStep?.impl || 'rrf'
  const weights = fuseStep?.params?.weights
  // Plain RRF is recomputed client-side; weighted RRF and linear fusion show the server's formula.
  const plainRrf = fuseImpl === 'rrf' && !(Array.isArray(weights) && weights.some((w) => Number(w) !== 1))
  const rrf = selected && plainRrf ? rrfBreakdown(selected, fuseK(trace)) : null
  if (!table.rows.length) return <p className="sm-muted">{t('inspector.empty')}</p>

  return (
    <div className="insp-stack">
      <div className="insp-table-wrap">
        <table className="insp-table insp-rank-table">
          <thead>
            <tr>
              <th scope="col">{t('inspector.product')}</th>
              {table.columns.map((c) => <th key={c.id} scope="col" className="num">{columnLabel(c, t)}</th>)}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr
                key={row.id}
                className={row.id === selectedId ? 'is-selected' : ''}
                tabIndex={0}
                aria-current={row.id === selectedId ? 'true' : undefined}
                onClick={() => setSelectedId(row.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(row.id) } }}
              >
                <th scope="row" className="insp-rank-title"><span title={row.title}>{row.title}</span><code>{row.id}</code></th>
                {table.columns.map((c) => <RankCell key={c.id} row={row} column={c} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section>
        <h3 className="insp-h">{t('inspector.movement')}</h3>
        <p className="sm-muted sm-small">{t('inspector.movementHint')}</p>
        <RankMovementChart table={table} selectedId={selectedId} onSelect={setSelectedId} t={t} />
      </section>

      <section className="insp-formula" aria-live="polite">
        <h3 className="insp-h">{t('inspector.formula')}</h3>
        {!selected ? <p className="sm-muted">{t('inspector.formulaPick')}</p> : (
          <>
            <p className="insp-formula-title"><strong>{selected.title}</strong> <code>{selected.id}</code></p>
            {rrf ? (
              <div className="insp-formula-lines">
                <p><span className="sm-muted">RRF(d) = Σ 1/(k + rank<sub>i</sub>(d)), k = {rrf.k}</span></p>
                <p>
                  {rrf.terms.map((term, i) => (
                    <span key={term.ranking}>{i > 0 && ' + '}<span className="insp-term"><small>{term.ranking}</small>1/({rrf.k}+{term.rank})</span></span>
                  ))}
                </p>
                <p>= {rrf.denominators}</p>
                <p>= {rrf.values}</p>
                <p><strong>= {rrf.total.toFixed(6)}</strong></p>
              </div>
            ) : selected.formula ? (
              <div className="insp-formula-lines">
                <p><span className="sm-muted">{fuseImpl === 'linear'
                  ? 'Linear(d) = Σ wᵢ · minmax(scoreᵢ(d))'
                  : `Weighted RRF(d) = Σ wᵢ/(k + rankᵢ(d))`}{Array.isArray(weights) ? `, w = [${weights.join(', ')}]` : ''}</span></p>
                {selected.contributions && (
                  <p>{Object.entries(selected.contributions).map(([name, c], i) => (
                    <span key={name}>{i > 0 && ' + '}<span className="insp-term"><small>{name} #{c.rank}</small>{Number(c.score).toFixed(4)}</span></span>
                  ))}</p>
                )}
                <p><strong>{selected.formula}</strong></p>
              </div>
            ) : <p className="sm-muted">{t('inspector.empty')}</p>}
            {selected.rerank && (
              <p className="insp-rerank">{t('inspector.rerank', { before: selected.rerank.before ?? '—', after: selected.rerank.after ?? '—', score: formatScore(selected.rerank.score, 3) })}</p>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function TermsTab({ trace, titles }) {
  const { t } = useI18n()
  const view = matchedTermsView(trace, { titles })
  if (!view.rows.length) return <p className="sm-muted">{t('inspector.noMatches')}</p>
  return (
    <ol className="insp-terms">
      {view.rows.map((row) => (
        <li key={row.id}>
          <div className="insp-terms-head">
            <span className="insp-terms-rank">#{row.rank ?? '—'}</span>
            <span className="insp-terms-title"><Highlighted text={row.title} terms={row.allTerms} /></span>
            <span className="insp-terms-score" title="BM25">{formatScore(row.score, 2)}</span>
          </div>
          <div className="insp-terms-fields">
            {Object.entries(row.fields).map(([field, terms]) => (
              <span key={field} className="insp-field-chip">
                <small>{field}</small>
                {terms.map((term) => <mark key={term}>{term}</mark>)}
              </span>
            ))}
            {!Object.keys(row.fields).length && <span className="sm-muted sm-small">—</span>}
          </div>
        </li>
      ))}
    </ol>
  )
}

function DslTab({ trace }) {
  const { t } = useI18n()
  const view = queryDslView(trace)
  if (!view) return <p className="sm-muted">{t('inspector.noDsl')}</p>
  return (
    <div className="insp-stack">
      <p className="sm-muted sm-small">{t('inspector.dslHint')} <code>{view.stepId}</code></p>
      <JsonBlock value={view.dsl} label="Elasticsearch query DSL" />
    </div>
  )
}

function ComposeTab({ trace }) {
  const { t } = useI18n()
  const view = composeView(trace)
  if (!view) return null
  return (
    <div className="insp-stack">
      <p className="insp-compose-formula"><code>{view.formula}</code></p>
      <dl className="insp-dl">
        <div><dt>{t('inspector.alpha')}</dt><dd>{view.alpha ?? '—'}</dd></div>
        {view.image && <div><dt>e_img</dt><dd>{t('inspector.vector', { dims: view.image.dims, norm: view.image.norm })}</dd></div>}
        {view.text && <div><dt>e_text</dt><dd>{t('inspector.vector', { dims: view.text.dims, norm: view.text.norm })}</dd></div>}
        {view.query && <div><dt>q</dt><dd>{t('inspector.vector', { dims: view.query.dims, norm: view.query.norm })}</dd></div>}
      </dl>
      {view.summary && <p className="sm-muted">{view.summary}</p>}
    </div>
  )
}

export default function SearchInspector({ trace, titles = {} }) {
  const { t } = useI18n()
  const hasCompose = Boolean(composeView(trace))
  const tabs = [
    { id: 'query', label: t('inspector.tab.query') },
    ...(hasCompose ? [{ id: 'compose', label: t('inspector.tab.compose') }] : []),
    { id: 'ranking', label: t('inspector.tab.ranking') },
    { id: 'terms', label: t('inspector.tab.terms') },
    { id: 'perf', label: t('inspector.tab.perf') },
    { id: 'dsl', label: t('inspector.tab.dsl') },
  ]
  const [tab, setTab] = useState('query')
  return (
    <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('inspector.title')}>
      {tab === 'query' && <QueryTab trace={trace} />}
      {tab === 'compose' && <ComposeTab trace={trace} />}
      {tab === 'ranking' && <RankingTab key={trace?.trace_id} trace={trace} titles={titles} />}
      {tab === 'terms' && <TermsTab trace={trace} titles={titles} />}
      {tab === 'perf' && <Waterfall trace={trace} />}
      {tab === 'dsl' && <DslTab trace={trace} />}
    </Tabs>
  )
}
