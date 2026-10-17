import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { getTrace, listTraces } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { openInspector } from '../lib/inspector.js'
import { formatDateTime, formatMs } from '../lib/format.js'
import { Card, EmptyState, ErrorState, JsonView, Modal, PageHeader, Pagination, Pill, Skeleton, TableSkeleton } from '../components/ui.jsx'

const KINDS = ['search', 'image_search', 'compose_search', 'rag', 'chat', 'compare', 'plan']
const LIMIT = 20

function TraceModal({ traceId, onClose }) {
  const { data, error, loading, reload } = useAsync((signal) => (traceId ? getTrace({ traceId, signal }) : Promise.resolve({ data: null })), [traceId])
  return (
    <Modal open={!!traceId} title={`Trace ${traceId || ''}`} onClose={onClose} wide>
      <p className="adm-muted adm-small">The Inspector is not mounted on this page, so the raw trace JSON is shown instead.</p>
      {loading && <Skeleton lines={10} />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && <JsonView value={data} />}
    </Modal>
  )
}

export default function TracesPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const kind = params.get('kind') || ''
  const offset = Number(params.get('offset')) || 0
  const [draft, setDraft] = useState(q)
  const [fallbackId, setFallbackId] = useState(null)

  useEffect(() => setDraft(q), [q])

  const { data, error, loading, reload } = useAsync((signal) => listTraces({ q, kind, limit: LIMIT, offset, signal }), [q, kind, offset])

  function setParam(patch) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null || v === 0) next.delete(k)
      else next.set(k, String(v))
    }
    setParams(next, { replace: true })
  }

  function open(traceId) {
    const { acknowledged } = openInspector(traceId)
    if (!acknowledged) setFallbackId(traceId)
  }

  const items = data?.items || []

  return (
    <>
      <PageHeader title="Traces" description="Every search, RAG and chat request records a pipeline trace. Click a row to open it in the Inspector." />
      <Card>
        <form className="adm-toolbar" role="search" onSubmit={(e) => { e.preventDefault(); setParam({ q: draft.trim(), offset: 0 }) }}>
          <label className="adm-field adm-field-grow">
            <span className="adm-sr-only">Search traces</span>
            <input type="search" placeholder="Search by trace id or query…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <label className="adm-field">
            <span className="adm-sr-only">Kind</span>
            <select value={kind} onChange={(e) => setParam({ kind: e.target.value, offset: 0 })}>
              <option value="">All kinds</option>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <button type="submit" className="adm-btn">Search</button>
        </form>
        {loading && !data ? <TableSkeleton cols={5} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
          <EmptyState title="No traces found" message={q || kind ? 'Try a different query or kind.' : 'Traces appear here once the storefront receives traffic.'} />
        ) : (
          <div className={`adm-table-wrap ${loading ? 'adm-refreshing' : ''}`}>
            <table className="adm-table adm-table-hover">
              <thead>
                <tr><th scope="col">Time</th><th scope="col">Kind</th><th scope="col">Pipeline</th><th scope="col">Input</th><th scope="col" className="num">Duration</th><th scope="col">Trace id</th></tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.trace_id} tabIndex={0} onClick={() => open(t.trace_id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(t.trace_id) } }} aria-label={`Open trace ${t.trace_id}`}>
                    <td className="nowrap">{formatDateTime(t.created_at)}</td>
                    <td><Pill value={t.kind} /></td>
                    <td><code>{t.pipeline}</code></td>
                    <td className="adm-ellipsis">{t.input_summary}</td>
                    <td className="num nowrap">{formatMs(t.duration_ms)}</td>
                    <td><code className="adm-small">{t.trace_id}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination total={data?.total} limit={LIMIT} offset={offset} onChange={(o) => setParam({ offset: o })} />
      </Card>
      <TraceModal traceId={fallbackId} onClose={() => setFallbackId(null)} />
    </>
  )
}
