import { useState } from 'react'
import { Link } from 'react-router'
import { getStats } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui.jsx'
import { BarChart, LineChart, Sparkline } from '../charts/index.js'
import { formatCount, formatMs, formatPercent, positiveRate } from '../lib/format.js'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

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
  const { t } = useI18n()
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <EmptyState title={emptyText} />
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead><tr><th scope="col">{t('adm.query')}</th><th scope="col" className="num">{t('adm.count')}</th>{labelQuery && <th scope="col"><span className="adm-sr-only">{t('adm.actions')}</span></th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.query}>
                  <td>{r.query}</td>
                  <td className="num">{formatCount(r.count)}</td>
                  {labelQuery && <td className="num"><Link to={`/admin/annotate?q=${encodeURIComponent(r.query)}`} aria-label={`${t('adm.dash.label')}: ${r.query}`}>{t('adm.dash.label')}</Link></td>}
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
  const { t } = useI18n()
  const { data, error, loading, reload } = useAsync((signal) => getStats({ days, signal }), [days])

  const daily = data?.daily || []
  const totals = data?.totals || {}
  const latencyEntries = Object.entries(data?.latency || {})
  const thumbs = positiveRate(totals)

  return (
    <>
      <PageHeader
        title={t('adm.dash.title')}
        description={t('adm.dash.intro')}
        actions={(
          <div className="adm-segmented" role="group" aria-label={t('adm.dash.range')}>
            {RANGES.map((d) => (
              <button key={d} type="button" className={d === days ? 'active' : ''} aria-pressed={d === days} onClick={() => setDays(d)}>{t('adm.dash.days', { count: d })}</button>
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
            <Kpi label={t('adm.dash.searches')} value={formatCount(totals.searches)} hint={t('adm.dash.lastDays', { count: days })} trend={<Sparkline values={daily.map((d) => d.searches)} label={t('adm.dash.searchTrend')} />} />
            <Kpi label={t('adm.dash.chats')} value={formatCount(totals.chats)} hint={t('adm.dash.lastDays', { count: days })} trend={<Sparkline values={daily.map((d) => d.chats)} label={t('adm.dash.chatTrend')} />} />
            <Kpi label={t('adm.dash.thumbs')} value={formatPercent(thumbs)} hint={`${formatCount(totals.feedback_positive)} 👍 · ${formatCount(totals.feedback_negative)} 👎`} />
            <Kpi label={t('adm.dash.zero')} value={formatPercent(totals.zero_result_rate)} hint={t('adm.dash.zeroHint')} />
            <Kpi label={t('adm.dash.abstain')} value={formatPercent(totals.abstain_rate)} hint={t('adm.dash.abstainHint')} />
          </div>
          <div className="adm-grid-2">
            <Card title={t('adm.dash.daily')}>
              {daily.length ? (
                <LineChart
                  title={t('adm.dash.dailyTitle')}
                  description={t('adm.dash.dailyDesc', { count: days })}
                  labels={daily.map((d) => d.date.slice(5))}
                  series={[{ name: t('adm.dash.searches'), values: daily.map((d) => d.searches) }, { name: t('adm.dash.chats'), values: daily.map((d) => d.chats) }]}
                  formatValue={formatCount}
                />
              ) : <EmptyState title={t('adm.dash.noTraffic')} />}
            </Card>
            <Card title={t('adm.dash.latency')}>
              {latencyEntries.length ? (
                <BarChart
                  title={t('adm.dash.latencyTitle')}
                  description={t('adm.dash.latencyDesc')}
                  categories={latencyEntries.map(([name]) => name)}
                  series={[
                    { name: 'p50', values: latencyEntries.map(([, v]) => v.p50) },
                    { name: 'p95', values: latencyEntries.map(([, v]) => v.p95) },
                  ]}
                  formatValue={(v) => formatMs(v).replace(' ms', '')}
                  unit=" ms"
                />
              ) : <EmptyState title={t('adm.dash.noLatency')} />}
            </Card>
          </div>
          <div className="adm-grid-2">
            <QueryTable title={t('adm.dash.top')} rows={data.top_queries || []} emptyText={t('adm.dash.noQueries')} />
            <QueryTable title={t('adm.dash.zeroQueries')} rows={data.zero_result_queries || []} emptyText={t('adm.dash.noZero')} labelQuery />
          </div>
        </div>
      )}
    </>
  )
}
