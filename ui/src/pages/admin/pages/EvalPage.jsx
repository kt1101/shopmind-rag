import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { listEvalRuns, startJob } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { MAX_COMPARE, MIN_COMPARE, compareChartData, compareMetricKeys, metricLabel, numericMetrics, toggleSelection } from '../lib/evalCompare.js'
import { formatDateTime, formatDelta, formatMetric } from '../lib/format.js'
import { BarChart } from '../charts/index.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, TableSkeleton } from '../components/ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

function CompareView({ runs }) {
  const { t } = useI18n()
  const chart = useMemo(() => compareChartData(runs), [runs])
  const keys = useMemo(() => compareMetricKeys(runs), [runs])
  const [base, ...others] = runs
  const baseMetrics = numericMetrics(base.metrics)
  return (
    <Card title={t('adm.ev.compare', { count: runs.length })}>
      <BarChart
        title={t('adm.ev.chart')}
        description={t('adm.ev.chartDesc', { metrics: chart.categories.join(', '), runs: runs.map((r) => r.name).join(', ') })}
        categories={chart.categories}
        series={chart.series}
        formatValue={formatMetric}
        height={260}
      />
      <h3>{t('adm.ev.delta')} <span className="adm-muted">({base.name})</span></h3>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact">
          <thead>
            <tr>
              <th scope="col">{t('adm.ev.metric')}</th>
              <th scope="col" className="num">{base.name}</th>
              {others.map((r) => <th key={r.id} scope="col" className="num">{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <th scope="row">{metricLabel(key)}</th>
                <td className="num">{formatMetric(baseMetrics[key])}</td>
                {others.map((r) => {
                  const value = numericMetrics(r.metrics)[key]
                  const delta = formatDelta(value, baseMetrics[key])
                  return (
                    <td key={r.id} className="num">
                      {formatMetric(value)}{' '}
                      <span className={`adm-delta adm-delta-${delta.sign > 0 ? 'up' : delta.sign < 0 ? 'down' : 'flat'}`}>
                        {delta.sign > 0 ? '▲' : delta.sign < 0 ? '▼' : ''} {delta.text}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export default function EvalPage() {
  const { data, error, loading, reload } = useAsync((signal) => listEvalRuns({ signal }), [])
  const [selected, setSelected] = useState([])
  const [kind, setKind] = useState('')
  const [jobNotice, setJobNotice] = useState(null)
  const { t } = useI18n()

  const items = data?.items || []
  const visible = kind ? items.filter((r) => r.kind === kind) : items
  const selectedRuns = selected.map((id) => items.find((r) => r.id === id)).filter(Boolean)

  async function runEval() {
    setJobNotice(null)
    try {
      const { data: job } = await startJob({ type: 'run_eval' })
      setJobNotice({ tone: 'good', job })
    } catch (err) {
      setJobNotice({ tone: 'bad', text: err.message })
    }
  }

  return (
    <>
      <PageHeader
        title={t('adm.ev.title')}
        description={t('adm.ev.intro')}
        actions={<button type="button" className="adm-btn adm-btn-primary" onClick={runEval}>{t('adm.ev.run')}</button>}
      />
      <Banner tone="info">{t('adm.ev.note')}</Banner>
      {jobNotice && (
        <Banner tone={jobNotice.tone}>
          {jobNotice.job ? <Link to={`/admin/jobs/${encodeURIComponent(jobNotice.job.id)}`}>{t('adm.ev.started', { job: jobNotice.job.id })}</Link> : t('adm.ev.startFailed', { message: jobNotice.text })}
        </Banner>
      )}
      <Card
        title={t('adm.ev.runs')}
        actions={(
          <label className="adm-field adm-field-inline">
            <span className="adm-sr-only">{t('adm.kind')}</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t('adm.allKinds')}</option>
              <option value="a1">{t('adm.ev.a1')}</option>
              <option value="a3">{t('adm.ev.a3')}</option>
            </select>
          </label>
        )}
      >
        {loading && !data ? <TableSkeleton cols={6} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : visible.length === 0 ? <EmptyState title={t('adm.ev.empty')} message={t('adm.ev.emptyText')} /> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col"><span className="adm-sr-only">{t('adm.ev.select')}</span></th>
                  <th scope="col">{t('adm.ev.runCol')}</th><th scope="col">{t('adm.kind')}</th><th scope="col">{t('adm.created')}</th>
                  <th scope="col" className="num">Recall@10</th><th scope="col" className="num">nDCG@10</th><th scope="col" className="num">MRR@10</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const m = numericMetrics(r.metrics)
                  const checked = selected.includes(r.id)
                  return (
                    <tr key={r.id} className={checked ? 'selected' : undefined}>
                      <td>
                        <input type="checkbox" checked={checked} onChange={() => setSelected((s) => toggleSelection(s, r.id))} aria-label={t('adm.ev.compareRun', { name: r.name })} />
                      </td>
                      <td><Link to={`/admin/eval/${encodeURIComponent(r.id)}`}>{r.name}</Link></td>
                      <td><Pill value={r.kind} /></td>
                      <td className="nowrap">{formatDateTime(r.created_at)}</td>
                      <td className="num">{formatMetric(m['recall@10'])}</td>
                      <td className="num">{formatMetric(m['ndcg@10'])}</td>
                      <td className="num">{formatMetric(m['mrr@10'])}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="adm-muted adm-small" aria-live="polite">
          {t('adm.ev.selected', { count: selected.length })}{selected.length > 0 && selected.length < MIN_COMPARE ? t('adm.ev.pickMore', { min: MIN_COMPARE }) : ''}{t('adm.ev.selectHint', { max: MAX_COMPARE })}
          {selected.length > 0 && <> <button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setSelected([])}>{t('adm.ev.clear')}</button></>}
        </p>
      </Card>
      {selectedRuns.length >= MIN_COMPARE && <CompareView runs={selectedRuns} />}
    </>
  )
}
