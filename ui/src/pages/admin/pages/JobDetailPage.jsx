import { Link, useParams } from 'react-router'
import { getJob } from '../../../shared/api/admin.js'
import { useJobPolling } from '../lib/useJobPolling.js'
import { formatDateTime } from '../lib/format.js'
import { Card, ErrorState, JsonView, PageHeader, Pill, Skeleton } from '../components/ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

export default function JobDetailPage() {
  const { jobId } = useParams()
  return <JobDetail key={jobId} jobId={jobId} />
}

function JobDetail({ jobId }) {
  const { t } = useI18n()
  const poll = useJobPolling(async (signal) => [(await getJob({ id: jobId, signal })).data])
  const job = poll.jobs[0]

  return (
    <>
      <PageHeader
        title={t('adm.jd.title', { id: jobId })}
        description={job ? `${job.type}` : undefined}
        actions={<Link to="/admin/indexes" className="adm-btn adm-btn-ghost">{t('adm.jd.back')}</Link>}
      />
      {!job && poll.status === 'error' && <ErrorState error={poll.error} onRetry={poll.refresh} />}
      {!job && poll.status !== 'error' && <Card><Skeleton lines={6} /></Card>}
      {job && (
        <div className="adm-grid-2 adm-grid-job">
          <Card title={t('adm.jd.details')}>
            <dl className="adm-dl">
              <dt>{t('adm.status')}</dt><dd><Pill value={job.status} /> {poll.status === 'polling' && <span className="adm-muted adm-small">{t('adm.jd.refreshing')}</span>}</dd>
              <dt>{t('adm.type')}</dt><dd>{job.type}</dd>
              <dt>{t('adm.created')}</dt><dd>{formatDateTime(job.created_at)}</dd>
              <dt>{t('adm.finished')}</dt><dd>{formatDateTime(job.finished_at)}</dd>
            </dl>
            <h3>{t('adm.jd.params')}</h3>
            <JsonView value={job.params || {}} />
          </Card>
          <Card title={t('adm.jd.log')}>
            <pre className="adm-log" aria-live="polite">{job.log || t('adm.jd.noLog')}</pre>
          </Card>
        </div>
      )}
    </>
  )
}
