import { useState } from 'react'
import { Link } from 'react-router'
import { getStats } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui.jsx'
import { BarChart, LineChart, Sparkline } from '../charts/index.js'
import { formatCount, formatMs, formatPercent, positiveRate } from '../lib/format.js'

const RANGES = [7, 14, 30]

function Kpi({ label, value, hint, trend, tone }) {
  return (
    <div className={`adm-kpi ${tone ? `adm-kpi-${tone}` : ''}`}>
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
      <div className="adm-kpi-foot">
        {hint && <span className="adm-muted adm-small">{hint}</span>}
        {trend}
      </div>
    </div>
  )
}

function QueryTable({ title, rows, emptyText, labelQuery }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th scope="col">Query</th><th scope="col" className="num">Count</th>{labelQuery && <th scope="col"><span className="adm-sr-only">Actions</span></th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.query}>
                  <td>{r.query}</td>
                  <td className="num">{formatCount(r.count)}</td>
                  {labelQuery && <td className="num"><Link to={`/admin/annotate?q=${encodeURIComponent(r.query)}`}>Label</Link></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function DashboardPage() {
  const [days, setDays] = useState(7)
  const { data, error, loading, reload } = useAsync((signal) => getStats({ days, signal }), [days])

  const daily = data?.daily || []
  const totals = data?.totals || {}
  const latencyEntries = Object.entries(data?.latency || {})
  const thumbs = positiveRate(totals)

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Traffic, quality and latency across search and RAG pipelines."
        actions={(
          <div className="adm-segmented" role="group" aria-label="Time range">
            {RANGES.map((d) => (
              <button key={d} type="button" className={d === days ? 'active' : ''} aria-pressed={d === days} onClick={() => setDays(d)}>{d} days</button>
            ))}
          </div>
        )}
      />
      {error && !data && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && (
        <div className="adm-kpis">{Array.from({ length: 5 }, (_, i) => <div key={i} className="adm-kpi"><Skeleton lines={2} height={20} /></div>)}</div>
      )}
      {data && (
        <div className={loading ? 'adm-refreshing' : ''} aria-busy={loading}>
          <div className="adm-kpis">
            <Kpi label="Searches" value={formatCount(totals.searches)} hint={`last ${days} days`} trend={<Sparkline values={daily.map((d) => d.searches)} label="Daily searches trend" />} />
            <Kpi label="Chats" value={formatCount(totals.chats)} hint={`last ${days} days`} trend={<Sparkline values={daily.map((d) => d.chats)} label="Daily chats trend" />} />
            <Kpi label="👍 rate" value={formatPercent(thumbs)} hint={`${formatCount(totals.feedback_positive)} 👍 · ${formatCount(totals.feedback_negative)} 👎`} />
            <Kpi label="Zero-result rate" value={formatPercent(totals.zero_result_rate)} hint="searches with no results" />
            <Kpi label="Abstain rate" value={formatPercent(totals.abstain_rate)} hint="RAG insufficient_evidence" />
          </div>
          <div className="adm-grid-2">
            <Card title="Daily volume">
              {daily.length ? (
                <LineChart
                  title="Daily searches and chats"
                  description={`Searches and chats per day over the last ${days} days.`}
                  labels={daily.map((d) => d.date.slice(5))}
                  series={[{ name: 'Searches', values: daily.map((d) => d.searches) }, { name: 'Chats', values: daily.map((d) => d.chats) }]}
                  formatValue={formatCount}
                />
              ) : <EmptyState title="No traffic in this range" />}
            </Card>
            <Card title="Latency by pipeline">
              {latencyEntries.length ? (
                <BarChart
                  title="p50 and p95 latency per pipeline"
                  description="Median and 95th percentile latency in milliseconds per pipeline."
                  categories={latencyEntries.map(([name]) => name)}
                  series={[
                    { name: 'p50', values: latencyEntries.map(([, v]) => v.p50) },
                    { name: 'p95', values: latencyEntries.map(([, v]) => v.p95) },
                  ]}
                  formatValue={(v) => formatMs(v).replace(' ms', '')}
                  unit=" ms"
                />
              ) : <EmptyState title="No latency samples yet" />}
            </Card>
          </div>
          <div className="adm-grid-2">
            <QueryTable title="Top queries" rows={data.top_queries || []} emptyText="No queries yet" />
            <QueryTable title="Zero-result queries" rows={data.zero_result_queries || []} emptyText="No zero-result queries 🎉" labelQuery />
          </div>
        </div>
      )}
    </>
  )
}
