import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { getFilterOptions, getPipelines, resolveImageUrl, searchText } from '../../../api.js'
import { productPath } from '../../../lib/urlState.js'
import InspectorDrawer from '../../../widgets/inspector/InspectorDrawer.jsx'
import { useAsync } from '../lib/useAsync.js'
import { formatMs } from '../lib/format.js'
import { searchPipelineOptions } from '../lib/pipelines.js'
import {
  OVERLAP_K, TOP_K_CHOICES, buildPlaygroundParams, crossRanks, formatRatio, overlapAtK, parsePlaygroundParams, pipelinesToRun,
} from '../lib/playground.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, Skeleton } from '../components/ui.jsx'
import { normalizeOptions } from '../../../shared/api/filters.js'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

const SIDES = ['A', 'B']

function PipelineSelect({ id, label, value, options, onChange, allowNone, exclude }) {
  const { t } = useI18n()
  const selected = options.find((p) => p.name === value)
  return (
    <label className="adm-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">{t('adm.pg.none')}</option>}
        {options.map((p) => (
          <option key={p.name} value={p.name} disabled={p.name === exclude}>
            {p.name}{p.isDefault ? t('adm.pg.defaultTag') : ''}{p.hidden ? t('adm.pg.evalTag') : ''}
          </option>
        ))}
      </select>
      <small className="adm-muted adm-small">{selected ? selected.description || t('adm.pg.noDescription') : allowNone ? t('adm.pg.compareHint') : ''}</small>
    </label>
  )
}

function FilterSelect({ id, label, anyLabel, field, value, onChange }) {
  const { data } = useAsync((signal) => getFilterOptions({ field, limit: 50, signal }), [field])
  // The backend sends [{value, count}] (the contract says [str]); keep the values.
  const options = useMemo(() => normalizeOptions(data?.options).map((o) => o.value), [data])
  return (
    <label className="adm-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{anyLabel}</option>
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function ResultColumn({ side, run, other, onInspect }) {
  const { t } = useI18n()
  const ranks = useMemo(() => new Map(crossRanks(run?.results, other?.results).map((x) => [x.productId, x])), [run, other])
  if (!run) return null
  const serverMs = run.trace?.duration_ms
  return (
    <section className="adm-card adm-pg-col" aria-busy={run.status === 'loading'} aria-label={t('adm.pg.column', { side, name: run.pipeline })}>
      <header className="adm-pg-col-head">
        <div>
          <span className="adm-pg-side">{side}</span>
          <code>{run.pipeline}</code>
          {run.data?.pipeline && run.data.pipeline !== run.pipeline && <span className="adm-muted adm-small">{t('adm.pg.ran', { name: run.data.pipeline })}</span>}
        </div>
        <button type="button" className="adm-btn adm-btn-small" disabled={!run.trace} onClick={() => onInspect(run)}>{t('adm.pg.inspect')}</button>
      </header>
      <dl className="adm-pg-stats">
        <div><dt>{t('adm.pg.results')}</dt><dd>{run.status === 'done' ? run.results.length : '—'}</dd></div>
        <div><dt>{t('adm.pg.roundTrip')}</dt><dd>{run.durationMs != null ? formatMs(run.durationMs) : '—'}</dd></div>
        <div><dt>{t('adm.pg.server')}</dt><dd>{Number.isFinite(serverMs) ? formatMs(serverMs) : '—'}</dd></div>
        <div><dt>{t('adm.pg.steps')}</dt><dd>{run.trace?.steps?.length ?? '—'}</dd></div>
      </dl>
      {run.status === 'loading' && <Skeleton lines={6} />}
      {run.status === 'error' && <ErrorState error={run.error} title={t('adm.pg.failed')} />}
      {run.status === 'done' && run.results.length === 0 && <EmptyState title={t('adm.pg.empty')} message={t('adm.pg.emptyText')} />}
      {run.status === 'done' && run.results.length > 0 && (
        <ol className="adm-pg-results">
          {run.results.map((item, i) => {
            const cross = ranks.get(String(item.product_id))
            const img = resolveImageUrl(item.image_url)
            const shared = other && cross?.otherRank != null
            return (
              <li key={item.product_id} className={other ? (shared ? 'is-shared' : 'is-unique') : undefined}>
                <span className="adm-pg-rank">#{item.rank ?? i + 1}</span>
                <span className="adm-pg-thumb">{img ? <img src={img} alt="" loading="lazy" /> : <span aria-hidden="true">◇</span>}</span>
                <span className="adm-pg-title">
                  <Link to={productPath(item.product_id)} target="_blank" rel="noopener">{item.title || item.product_id}</Link>
                  <small className="adm-muted">{[item.brand, item.category, item.product_id].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="adm-pg-score num">{Number.isFinite(item.score) ? item.score.toFixed(4) : '—'}</span>
                {other && (
                  <span className="adm-pg-cross adm-small" title={shared ? t('adm.pg.otherRank', { rank: cross.otherRank }) : t('adm.pg.notInOther')}>
                    {shared ? <>{side === 'A' ? 'B' : 'A'} #{cross.otherRank}{cross.delta ? <em className={cross.delta > 0 ? 'up' : 'down'}> {cross.delta > 0 ? '▲' : '▼'}{Math.abs(cross.delta)}</em> : null}</> : <Pill tone="warn">{t('adm.pg.only', { side })}</Pill>}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

const EMPTY = { status: 'idle', results: [], data: null, trace: null, durationMs: null, error: null }

// Admin Search Playground: one query through one or two named pipelines (public or
// evaluation-only) with explain=true, side by side, overlap@10 and the Inspector per side.
export default function SearchPlaygroundPage() {
  const [params, setParams] = useSearchParams()
  const urlState = useMemo(() => parsePlaygroundParams(params), [params])
  const meta = useAsync((signal) => getPipelines({ includeHidden: true, signal }), [])
  const defaultName = meta.data?.defaults?.search ?? null
  const options = useMemo(() => searchPipelineOptions(meta.data?.pipelines, { defaultName }), [meta.data, defaultName])

  const [draft, setDraft] = useState(urlState)
  const [runs, setRuns] = useState({})
  const [inspected, setInspected] = useState(null)
  const controller = useRef(null)
  const { t } = useI18n()

  useEffect(() => setDraft(urlState), [urlState])

  // Pick sensible pipelines once the list arrives: A = storefront default, B = another public one.
  useEffect(() => {
    if (!options.length) return
    setDraft((d) => {
      const known = (name) => options.some((p) => p.name === name)
      const a = known(d.pipelineA) ? d.pipelineA : options[0].name
      const b = d.pipelineB && known(d.pipelineB) ? d.pipelineB : params.has('a') ? '' : (options.find((p) => p.name !== a && !p.hidden)?.name ?? '')
      return a === d.pipelineA && b === d.pipelineB ? d : { ...d, pipelineA: a, pipelineB: b === a ? '' : b }
    })
  }, [options]) // eslint-disable-line react-hooks/exhaustive-deps

  // Run whenever the URL names a query and at least one pipeline.
  useEffect(() => {
    const names = pipelinesToRun(urlState)
    if (!urlState.query || !names.length) {
      setRuns({})
      return undefined
    }
    controller.current?.abort()
    const ac = new AbortController()
    controller.current = ac
    const filters = Object.fromEntries(Object.entries(urlState.filters).filter(([, v]) => v))
    setRuns(Object.fromEntries(names.map((name, i) => [SIDES[i], { ...EMPTY, pipeline: name, status: 'loading' }])))
    names.forEach((name, i) => {
      searchText({ query: urlState.query, pipeline: name, topK: urlState.topK, filters, explain: true, signal: ac.signal })
        .then((res) => {
          if (ac.signal.aborted) return
          const data = res?.data || {}
          setRuns((current) => ({ ...current, [SIDES[i]]: { ...EMPTY, pipeline: name, status: 'done', data, results: data.results || [], trace: data.trace || null, durationMs: res?.durationMs ?? null } }))
        })
        .catch((error) => {
          if (ac.signal.aborted || error?.name === 'AbortError') return
          setRuns((current) => ({ ...current, [SIDES[i]]: { ...EMPTY, pipeline: name, status: 'error', error } }))
        })
    })
    return () => ac.abort()
  }, [urlState])

  function submit(event) {
    event.preventDefault()
    setParams(buildPlaygroundParams(draft))
  }

  const a = runs.A
  const b = runs.B
  const overlap = a?.status === 'done' && b?.status === 'done' ? overlapAtK(a.results, b.results, OVERLAP_K) : null
  const titles = Object.fromEntries([...(a?.results || []), ...(b?.results || [])].map((p) => [p.product_id, p.title]))
  const busy = Object.values(runs).some((run) => run.status === 'loading')

  return (
    <>
      <PageHeader
        title={t('adm.pg.title')}
        description={t('adm.pg.intro')}
      />
      <Card>
        {meta.error && !meta.data && <ErrorState error={meta.error} onRetry={meta.reload} title={t('adm.pg.pipelinesFailed')} />}
        <form className="adm-pg-form" onSubmit={submit} role="search">
          <label className="adm-field adm-pg-query" htmlFor="pg-q">
            <span>{t('adm.pg.query')}</span>
            <input id="pg-q" type="search" value={draft.query} onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))} placeholder={t('adm.pg.queryPlaceholder')} />
          </label>
          <PipelineSelect id="pg-a" label={t('adm.pg.a')} value={draft.pipelineA} options={options} onChange={(v) => setDraft((d) => ({ ...d, pipelineA: v, pipelineB: d.pipelineB === v ? '' : d.pipelineB }))} />
          <PipelineSelect id="pg-b" label={t('adm.pg.b')} value={draft.pipelineB} options={options} allowNone exclude={draft.pipelineA} onChange={(v) => setDraft((d) => ({ ...d, pipelineB: v }))} />
          <FilterSelect id="pg-category" label={t('adm.pg.category')} anyLabel={t('adm.pg.anyCategory')} field="category" value={draft.filters.category} onChange={(v) => setDraft((d) => ({ ...d, filters: { ...d.filters, category: v } }))} />
          <FilterSelect id="pg-brand" label={t('adm.pg.brand')} anyLabel={t('adm.pg.anyBrand')} field="brand" value={draft.filters.brand} onChange={(v) => setDraft((d) => ({ ...d, filters: { ...d.filters, brand: v } }))} />
          <label className="adm-field" htmlFor="pg-k">
            <span>{t('adm.pg.topK')}</span>
            <select id="pg-k" value={draft.topK} onChange={(e) => setDraft((d) => ({ ...d, topK: Number(e.target.value) }))}>
              {TOP_K_CHOICES.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <div className="adm-pg-actions">
            <button type="submit" className="adm-btn adm-btn-primary" disabled={!draft.query.trim() || !draft.pipelineA || busy}>{busy ? t('adm.pg.running') : t('adm.pg.run')}</button>
          </div>
        </form>
        {meta.loading && !meta.data && <Skeleton lines={2} />}
      </Card>

      {!urlState.query ? (
        <Card><EmptyState title={t('adm.pg.start')} message={t('adm.pg.startText')} /></Card>
      ) : (
        <>
          {overlap && (
            <Banner tone={overlap.ratio >= 0.7 ? 'good' : overlap.ratio >= 0.4 ? 'info' : 'warn'}>
              <strong>{t('adm.pg.overlap', { k: OVERLAP_K, shared: overlap.shared, denominator: overlap.denominator, ratio: formatRatio(overlap.ratio) })}</strong>
              <span className="adm-muted">{t('adm.pg.overlapDetail', { a: overlap.onlyA.length, b: overlap.onlyB.length })}</span>
            </Banner>
          )}
          <div className={b ? 'adm-pg-grid' : 'adm-pg-grid is-single'}>
            <ResultColumn side="A" run={a} other={b} onInspect={setInspected} />
            {b && <ResultColumn side="B" run={b} other={a} onInspect={setInspected} />}
          </div>
        </>
      )}

      <InspectorDrawer open={Boolean(inspected)} onClose={() => setInspected(null)} trace={inspected?.trace} titles={titles} view="search" />
    </>
  )
}
