import { useNavigate, useSearchParams } from 'react-router'
import { listFeedback } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { formatDateTime } from '../lib/format.js'
import { Card, EmptyState, ErrorState, PageHeader, Pagination, Pill, TableSkeleton } from '../components/ui.jsx'

const LIMIT = 20

export default function FeedbackPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const rating = params.get('rating') || ''
  const target = params.get('target') || ''
  const offset = Number(params.get('offset')) || 0
  const { data, error, loading, reload } = useAsync((signal) => listFeedback({ limit: LIMIT, offset, rating, target, signal }), [rating, target, offset])

  function setParam(patch) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null || v === 0) next.delete(k)
      else next.set(k, String(v))
    }
    setParams(next, { replace: true })
  }

  function labelThis(item) {
    const search = new URLSearchParams({ q: item.query || '' })
    if (item.product_id) search.set('product', item.product_id)
    navigate(`/admin/annotate?${search}`)
  }

  const items = data?.items || []

  return (
    <>
      <PageHeader title="Feedback" description="👍/👎 from shoppers on search results and answers. Turn feedback into relevance labels." />
      <Card>
        <div className="adm-toolbar">
          <div className="adm-segmented" role="group" aria-label="Rating">
            {[['', 'All'], ['1', '👍 Positive'], ['-1', '👎 Negative']].map(([value, label]) => (
              <button key={value} type="button" className={rating === value ? 'active' : ''} aria-pressed={rating === value} onClick={() => setParam({ rating: value, offset: 0 })}>{label}</button>
            ))}
          </div>
          <label className="adm-field">
            <span className="adm-sr-only">Target</span>
            <select value={target} onChange={(e) => setParam({ target: e.target.value, offset: 0 })}>
              <option value="">Search + answers</option>
              <option value="search">Search results</option>
              <option value="answer">RAG answers</option>
            </select>
          </label>
        </div>
        {loading && !data ? <TableSkeleton cols={6} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
          <EmptyState title="No feedback" message={rating || target ? 'No feedback matches these filters.' : 'Feedback shows up once shoppers rate results.'} />
        ) : (
          <div className={`adm-table-wrap ${loading ? 'adm-refreshing' : ''}`}>
            <table className="adm-table">
              <thead><tr><th scope="col">Time</th><th scope="col">Rating</th><th scope="col">Target</th><th scope="col">Query</th><th scope="col">Product</th><th scope="col">Comment</th><th scope="col"><span className="adm-sr-only">Actions</span></th></tr></thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.id}>
                    <td className="nowrap">{formatDateTime(f.created_at)}</td>
                    <td><span aria-label={f.rating > 0 ? 'positive' : 'negative'}>{f.rating > 0 ? '👍' : '👎'}</span></td>
                    <td><Pill value={f.target} /></td>
                    <td>{f.query || <span className="adm-muted">—</span>}</td>
                    <td>{f.product_id ? <code className="adm-small">{f.product_id}</code> : <span className="adm-muted">—</span>}</td>
                    <td className="adm-ellipsis">{f.comment || <span className="adm-muted">—</span>}</td>
                    <td className="nowrap">
                      <button type="button" className="adm-btn adm-btn-small" disabled={!f.query} onClick={() => labelThis(f)}>Label this</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination total={data?.total} limit={LIMIT} offset={offset} onChange={(o) => setParam({ offset: o })} />
      </Card>
    </>
  )
}
