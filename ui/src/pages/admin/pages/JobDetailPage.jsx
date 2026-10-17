import { Link, useParams } from 'react-router'
import { getJob } from '../../../shared/api/admin.js'
import { useJobPolling } from '../lib/useJobPolling.js'
import { formatDateTime } from '../lib/format.js'
import { Card, ErrorState, JsonView, PageHeader, Pill, Skeleton } from '../components/ui.jsx'

export default function JobDetailPage() {
  const { jobId } = useParams()
  return <JobDetail key={jobId} jobId={jobId} />
}

function JobDetail({ jobId }) {
  const poll = useJobPolling(async (signal) => [(await getJob({ id: jobId, signal })).data])
  const job = poll.jobs[0]

  return (
    <>
      <PageHeader
        title={`Job ${jobId}`}
        description={job ? `${job.type}` : undefined}
        actions={<Link to="/admin/indexes" className="adm-btn adm-btn-ghost">← All jobs</Link>}
      />
      {!job && poll.status === 'error' && <ErrorState error={poll.error} onRetry={poll.refresh} />}
      {!job && poll.status !== 'error' && <Card><Skeleton lines={6} /></Card>}
      {job && (
        <div className="adm-grid-2 adm-grid-job">
          <Card title="Details">
            <dl className="adm-dl">
              <dt>Status</dt><dd><Pill value={job.status} /> {poll.status === 'polling' && <span className="adm-muted adm-small">refreshing every 3s</span>}</dd>
              <dt>Type</dt><dd>{job.type}</dd>
              <dt>Created</dt><dd>{formatDateTime(job.created_at)}</dd>
              <dt>Finished</dt><dd>{formatDateTime(job.finished_at)}</dd>
            </dl>
            <h3>Params</h3>
            <JsonView value={job.params || {}} />
          </Card>
          <Card title="Log">
            <pre className="adm-log" aria-live="polite">{job.log || 'No output yet.'}</pre>
          </Card>
        </div>
      )}
    </>
  )
}
