import { Link, useParams } from 'react-router'
import { getEvalRun } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { metricLabel, numericMetrics } from '../lib/evalCompare.js'
import { formatDateTime, formatMetric } from '../lib/format.js'
import { Card, EmptyState, ErrorState, JsonView, PageHeader, Pill, Skeleton } from '../components/ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

export default function EvalRunPage() {
  const { runId } = useParams()
  const { t } = useI18n()
  const { data: run, error, loading, reload } = useAsync((signal) => getEvalRun({ id: runId, signal }), [runId])
  const metrics = Object.entries(numericMetrics(run?.metrics))

  return (
    <>
      <PageHeader
        title={run?.name || runId}
        description={run ? <>{t('adm.ev.recorded', { time: formatDateTime(run.created_at) })} · <Pill value={run.kind} /></> : undefined}
        actions={<Link to="/admin/eval" className="adm-btn adm-btn-ghost">{t('adm.ev.back')}</Link>}
      />
      {loading && !run && <Card><Skeleton lines={8} /></Card>}
      {error && !run && <ErrorState error={error} onRetry={reload} />}
      {run && (
        <div className="adm-grid-2">
          <Card title={t('adm.ev.metrics')}>
            {metrics.length === 0 ? <EmptyState title={t('adm.ev.noMetrics')} /> : (
              <table className="adm-table adm-table-compact">
                <tbody>
                  {metrics.map(([k, v]) => <tr key={k}><th scope="row">{metricLabel(k)}</th><td className="num">{formatMetric(v)}</td></tr>)}
                </tbody>
              </table>
            )}
            {run.summary && <p className="adm-muted adm-small">{run.summary}</p>}
          </Card>
          <Card title={t('adm.ev.config')}>
            <JsonView value={run.config || {}} />
          </Card>
        </div>
      )}
    </>
  )
}
