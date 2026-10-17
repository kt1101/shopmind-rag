import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { getTrace, listTraces } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { openInspector } from '../lib/inspector.js'
import { formatDateTime, formatMs } from '../lib/format.js'
import { Card, EmptyState, ErrorState, JsonView, Modal, PageHeader, Pagination, Pill, Skeleton, TableSkeleton } from '../components/ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

const KINDS = ['search', 'image_search', 'compose_search', 'rag', 'chat', 'compare', 'plan']
const LIMIT = 20

function TraceModal({ traceId, onClose }) {
  const { t } = useI18n()
  const { data, error, loading, reload } = useAsync((signal) => (traceId ? getTrace({ traceId, signal }) : Promise.resolve({ data: null })), [traceId])
  return (
    <Modal open={!!traceId} title={t('adm.tr.modal', { id: traceId || '' })} onClose={onClose} wide>
      <p className="adm-muted adm-small">{t('adm.tr.raw')}</p>
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
  const { t } = useI18n()

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
      <PageHeader title={t('adm.tr.title')} description={t('adm.tr.intro')} />
      <Card>
        <form className="adm-toolbar" role="search" onSubmit={(e) => { e.preventDefault(); setParam({ q: draft.trim(), offset: 0 }) }}>
          <label className="adm-field adm-field-grow">
            <span className="adm-sr-only">{t('adm.tr.search')}</span>
            <input type="search" placeholder={t('adm.tr.placeholder')} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <label className="adm-field">
            <span className="adm-sr-only">{t('adm.kind')}</span>
            <select value={kind} onChange={(e) => setParam({ kind: e.target.value, offset: 0 })}>
              <option value="">{t('adm.allKinds')}</option>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <button type="submit" className="adm-btn">{t('adm.tr.submit')}</button>
        </form>
        {loading && !data ? <TableSkeleton cols={5} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
          <EmptyState title={t('adm.tr.empty')} message={q || kind ? t('adm.tr.emptyFiltered') : t('adm.tr.emptyAll')} />
        ) : (
          <div className={`adm-table-wrap ${loading ? 'adm-refreshing' : ''}`}>
            <table className="adm-table adm-table-hover">
              <thead>
                <tr><th scope="col">{t('adm.time')}</th><th scope="col">{t('adm.kind')}</th><th scope="col">{t('adm.tr.pipeline')}</th><th scope="col">{t('adm.tr.input')}</th><th scope="col" className="num">{t('adm.tr.duration')}</th><th scope="col">{t('adm.tr.id')}</th></tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.trace_id} tabIndex={0} onClick={() => open(row.trace_id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(row.trace_id) } }} aria-label={t('adm.tr.open', { id: row.trace_id })}>
                    <td className="nowrap">{formatDateTime(row.created_at)}</td>
                    <td><Pill value={row.kind} /></td>
                    <td><code>{row.pipeline}</code></td>
                    <td className="adm-ellipsis" title={row.input_summary}>{row.input_summary}</td>
                    <td className="num nowrap">{formatMs(row.duration_ms)}</td>
                    <td><code className="adm-small">{row.trace_id}</code></td>
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
