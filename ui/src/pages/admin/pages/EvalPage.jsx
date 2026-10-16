import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { listEvalRuns, startJob } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { MAX_COMPARE, MIN_COMPARE, compareChartData, compareMetricKeys, metricLabel, numericMetrics, toggleSelection } from '../lib/evalCompare.js'
import { formatDateTime, formatDelta, formatMetric } from '../lib/format.js'
import { BarChart } from '../charts/index.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, TableSkeleton } from '../components/ui.jsx'

function CompareView({ runs }) {
  const chart = useMemo(() => compareChartData(runs), [runs])
  const keys = useMemo(() => compareMetricKeys(runs), [runs])
  const [base, ...others] = runs
  const baseMetrics = numericMetrics(base.metrics)
  return (
    <Card title={`Compare ${runs.length} runs`}>
      <BarChart
        title="Metric comparison"
        description={`Grouped bars of ${chart.categories.join(', ')} for runs ${runs.map((r) => r.name).join(', ')}.`}
        categories={chart.categories}
        series={chart.series}
        formatValue={formatMetric}
        height={260}
      />
      <h3>Delta vs baseline <span className="adm-muted">({base.name})</span></h3>
      <div className="adm-table-wrap">
        <table className="adm-table adm-table-compact">
          <thead>
            <tr>
              <th scope="col">Metric</th>
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
        title="Evaluation Center"
        description="Runs recorded from runs/*/metrics.json. Select 2–4 runs to compare."
        actions={<button type="button" className="adm-btn adm-btn-primary" onClick={runEval}>Run evaluation</button>}
      />
      <Banner tone="info">Qrels still need human review before results are reported; A3 seed cases are placeholders. Use the Annotation page to review judgments.</Banner>
      {jobNotice && (
        <Banner tone={jobNotice.tone}>
          {jobNotice.job ? <>Started <Link to={`/admin/jobs/${encodeURIComponent(jobNotice.job.id)}`}><code>{jobNotice.job.id}</code></Link>. The run appears here when it finishes.</> : `Could not start evaluation: ${jobNotice.text}`}
        </Banner>
      )}
      <Card
        title="Runs"
        actions={(
          <label className="adm-field adm-field-inline">
            <span className="adm-sr-only">Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All kinds</option>
              <option value="a1">A1 retrieval</option>
              <option value="a3">A3 RAG</option>
            </select>
          </label>
        )}
      >
        {loading && !data ? <TableSkeleton cols={6} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : visible.length === 0 ? <EmptyState title="No eval runs yet" message="Run an evaluation job to record one." /> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col"><span className="adm-sr-only">Select</span></th>
                  <th scope="col">Run</th><th scope="col">Kind</th><th scope="col">Created</th>
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
                        <input type="checkbox" checked={checked} onChange={() => setSelected((s) => toggleSelection(s, r.id))} aria-label={`Compare ${r.name}`} />
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
          {selected.length} selected{selected.length > 0 && selected.length < MIN_COMPARE ? `, pick at least ${MIN_COMPARE}` : ''} (max {MAX_COMPARE}; the first selected is the baseline).
          {selected.length > 0 && <> <button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={() => setSelected([])}>Clear</button></>}
        </p>
      </Card>
      {selectedRuns.length >= MIN_COMPARE && <CompareView runs={selectedRuns} />}
    </>
  )
}
