import { useState } from 'react'
import { Link } from 'react-router'
import { listIndexes, listJobs, startJob } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { useJobPolling } from '../lib/useJobPolling.js'
import { JOB_TYPES } from '../lib/jobPolling.js'
import { formatCount, formatDateTime } from '../lib/format.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, TableSkeleton } from '../components/ui.jsx'

export function JobTable({ jobs }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead><tr><th scope="col">Job</th><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Finished</th></tr></thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td><Link to={`/admin/jobs/${encodeURIComponent(job.id)}`}><code>{job.id}</code></Link></td>
              <td>{job.type}</td>
              <td><Pill value={job.status} /></td>
              <td className="nowrap">{formatDateTime(job.created_at)}</td>
              <td className="nowrap">{formatDateTime(job.finished_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function IndexesJobsPage() {
  const indexes = useAsync((signal) => listIndexes({ signal }), [])
  const jobs = useJobPolling(async (signal) => (await listJobs({ signal })).data?.items || [])
  const [starting, setStarting] = useState(null)
  const [startError, setStartError] = useState(null)
  const [started, setStarted] = useState(null)

  async function start(type) {
    setStartError(null)
    setStarted(null)
    setStarting(type)
    try {
      const { data } = await startJob({ type })
      jobs.jobUpdated(data)
      setStarted(data)
    } catch (error) {
      setStartError(error)
    } finally {
      setStarting(null)
    }
  }

  const indexItems = indexes.data?.items || []

  return (
    <>
      <PageHeader title="Indexes & Jobs" description="Stable aliases point at versioned physical indexes. Jobs wrap the offline scripts (build, validate, switch alias)." />
      <Card title="Aliases">
        {indexes.loading && !indexes.data ? <TableSkeleton cols={5} rows={3} /> : indexes.error && !indexes.data ? <ErrorState error={indexes.error} onRetry={indexes.reload} /> : indexItems.length === 0 ? <EmptyState title="No indexes found" message="Run the index scripts or a reindex job to create one." /> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th scope="col">Alias</th><th scope="col">Physical index</th><th scope="col" className="num">Docs</th><th scope="col">Vector fields</th><th scope="col">Embedders</th></tr></thead>
              <tbody>
                {indexItems.map((ix) => (
                  <tr key={ix.alias}>
                    <td><strong>{ix.alias}</strong></td>
                    <td><code>{ix.index}</code></td>
                    <td className="num">{formatCount(ix.doc_count)}</td>
                    <td>
                      <ul className="adm-inline-list">
                        {Object.entries(ix.vector_fields || {}).map(([field, dims]) => <li key={field}><code>{field}</code> <span className="adm-muted">{dims}d</span></li>)}
                      </ul>
                    </td>
                    <td>
                      <ul className="adm-inline-list">{(ix.embedder_ids || []).map((e) => <li key={e}><code className="adm-small">{e}</code></li>)}</ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Start a job">
        <div className="adm-job-buttons">
          {JOB_TYPES.map((j) => (
            <div key={j.type} className="adm-job-start">
              <button type="button" className="adm-btn adm-btn-primary" disabled={!!starting} onClick={() => start(j.type)}>
                {starting === j.type ? 'Starting…' : j.label}
              </button>
              <p className="adm-muted adm-small">{j.description}</p>
            </div>
          ))}
        </div>
        {started && <Banner tone="good">Started <Link to={`/admin/jobs/${encodeURIComponent(started.id)}`}>{started.id}</Link> ({started.type}).</Banner>}
        {startError && <Banner tone="bad">Could not start job: {startError.message}</Banner>}
      </Card>
      <Card
        title="Jobs"
        actions={(
          <span className="adm-muted adm-small" aria-live="polite">
            {jobs.status === 'polling' ? 'Auto-refreshing every 3s' : jobs.status === 'settled' ? 'Up to date' : ''}
            {' '}<button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={jobs.refresh}>Refresh</button>
          </span>
        )}
      >
        {jobs.error && jobs.jobs.length > 0 && <Banner tone="warn">Refresh failed ({jobs.error.message}); retrying.</Banner>}
        {jobs.status === 'loading' && jobs.jobs.length === 0 ? <TableSkeleton cols={5} /> : jobs.status === 'error' && jobs.jobs.length === 0 ? <ErrorState error={jobs.error} onRetry={jobs.refresh} /> : jobs.jobs.length === 0 ? <EmptyState title="No jobs yet" message="Start one above." /> : <JobTable jobs={jobs.jobs} />}
      </Card>
    </>
  )
}
