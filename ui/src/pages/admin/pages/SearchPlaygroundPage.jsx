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

const SIDES = ['A', 'B']

function PipelineSelect({ id, label, value, options, onChange, allowNone, exclude }) {
  const selected = options.find((p) => p.name === value)
  return (
    <label className="adm-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value="">— none (single pipeline) —</option>}
        {options.map((p) => (
          <option key={p.name} value={p.name} disabled={p.name === exclude}>
            {p.name}{p.isDefault ? ' · storefront default' : ''}{p.hidden ? ' · evaluation only' : ''}
          </option>
        ))}
      </select>
      <small className="adm-muted adm-small">{selected ? selected.description || 'No description.' : allowNone ? 'Compare against a second pipeline to see overlap.' : ''}</small>
    </label>
  )
}

function FilterSelect({ id, label, field, value, onChange }) {
  const { data } = useAsync((signal) => getFilterOptions({ field, limit: 100, signal }), [field])
  const options = data?.options || []
  return (
    <label className="adm-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any {label.toLowerCase()}</option>
        {value && !options.includes(value) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  )
}

function ResultColumn({ side, run, other, onInspect }) {
  const ranks = useMemo(() => new Map(crossRanks(run?.results, other?.results).map((x) => [x.productId, x])), [run, other])
  if (!run) return null
  const serverMs = run.trace?.duration_ms
  return (
    <section className="adm-card adm-pg-col" aria-busy={run.status === 'loading'} aria-label={`Pipeline ${side}: ${run.pipeline}`}>
      <header className="adm-pg-col-head">
        <div>
          <span className="adm-pg-side">{side}</span>
          <code>{run.pipeline}</code>
          {run.data?.pipeline && run.data.pipeline !== run.pipeline && <span className="adm-muted adm-small"> ran {run.data.pipeline}</span>}
        </div>
        <button type="button" className="adm-btn adm-btn-small" disabled={!run.trace} onClick={() => onInspect(run)}>Open inspector</button>
      </header>
      <dl className="adm-pg-stats">
        <div><dt>Results</dt><dd>{run.status === 'done' ? run.results.length : '—'}</dd></div>
        <div><dt>Round trip</dt><dd>{run.durationMs != null ? formatMs(run.durationMs) : '—'}</dd></div>
        <div><dt>Server</dt><dd>{Number.isFinite(serverMs) ? formatMs(serverMs) : '—'}</dd></div>
        <div><dt>Steps</dt><dd>{run.trace?.steps?.length ?? '—'}</dd></div>
      </dl>
      {run.status === 'loading' && <Skeleton lines={6} />}
      {run.status === 'error' && <ErrorState error={run.error} title="Search failed" />}
      {run.status === 'done' && run.results.length === 0 && <EmptyState title="No results" message="This pipeline returned nothing for the query and filters." />}
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
                  <span className="adm-pg-cross adm-small" title={shared ? `Rank ${cross.otherRank} in the other pipeline` : 'Not in the other top-k'}>
                    {shared ? <>{side === 'A' ? 'B' : 'A'} #{cross.otherRank}{cross.delta ? <em className={cross.delta > 0 ? 'up' : 'down'}> {cross.delta > 0 ? '▲' : '▼'}{Math.abs(cross.delta)}</em> : null}</> : <Pill tone="warn">only {side}</Pill>}
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
        title="Search Playground"
        description="Run one query through one or two search pipelines (including evaluation-only ones) with explain=true and compare the rankings side by side. Shoppers never choose a pipeline: the storefront runs the default set on the Config page."
      />
      <Card>
        {meta.error && !meta.data && <ErrorState error={meta.error} onRetry={meta.reload} title="Could not load pipelines" />}
        <form className="adm-pg-form" onSubmit={submit} role="search">
          <label className="adm-field adm-pg-query" htmlFor="pg-q">
            <span>Query</span>
            <input id="pg-q" type="search" value={draft.query} onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))} placeholder="e.g. giày bốt da màu nâu" />
          </label>
          <PipelineSelect id="pg-a" label="Pipeline A" value={draft.pipelineA} options={options} onChange={(v) => setDraft((d) => ({ ...d, pipelineA: v, pipelineB: d.pipelineB === v ? '' : d.pipelineB }))} />
          <PipelineSelect id="pg-b" label="Pipeline B" value={draft.pipelineB} options={options} allowNone exclude={draft.pipelineA} onChange={(v) => setDraft((d) => ({ ...d, pipelineB: v }))} />
          <FilterSelect id="pg-category" label="Category" field="category" value={draft.filters.category} onChange={(v) => setDraft((d) => ({ ...d, filters: { ...d.filters, category: v } }))} />
          <FilterSelect id="pg-brand" label="Brand" field="brand" value={draft.filters.brand} onChange={(v) => setDraft((d) => ({ ...d, filters: { ...d.filters, brand: v } }))} />
          <label className="adm-field" htmlFor="pg-k">
            <span>Top K</span>
            <select id="pg-k" value={draft.topK} onChange={(e) => setDraft((d) => ({ ...d, topK: Number(e.target.value) }))}>
              {TOP_K_CHOICES.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <div className="adm-pg-actions">
            <button type="submit" className="adm-btn adm-btn-primary" disabled={!draft.query.trim() || !draft.pipelineA || busy}>{busy ? 'Running…' : 'Run'}</button>
          </div>
        </form>
        {meta.loading && !meta.data && <Skeleton lines={2} />}
      </Card>

      {!urlState.query ? (
        <Card><EmptyState title="Type a query and run it" message="Pick the storefront default as A and a candidate as B to see what would change for shoppers." /></Card>
      ) : (
        <>
          {overlap && (
            <Banner tone={overlap.ratio >= 0.7 ? 'good' : overlap.ratio >= 0.4 ? 'info' : 'warn'}>
              <strong>Overlap@{OVERLAP_K}: {overlap.shared}/{overlap.denominator} ({formatRatio(overlap.ratio)})</strong>
              <span className="adm-muted"> · only in A: {overlap.onlyA.length} · only in B: {overlap.onlyB.length}. Scores are native to each pipeline and are not comparable across columns.</span>
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
