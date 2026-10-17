import { useState } from 'react'
import { Link } from 'react-router'
import { listIndexes, listJobs, startJob } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { useJobPolling } from '../lib/useJobPolling.js'
import { JOB_TYPES } from '../lib/jobPolling.js'
import { formatCount, formatDateTime } from '../lib/format.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Pill, TableSkeleton } from '../components/ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

export function JobTable({ jobs }) {
  const { t } = useI18n()
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead><tr><th scope="col">{t('adm.ix.job')}</th><th scope="col">{t('adm.type')}</th><th scope="col">{t('adm.status')}</th><th scope="col">{t('adm.created')}</th><th scope="col">{t('adm.finished')}</th></tr></thead>
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
  const { t } = useI18n()

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
      <PageHeader title={t('adm.ix.title')} description={t('adm.ix.intro')} />
      <Card title={t('adm.ix.aliases')}>
        {indexes.loading && !indexes.data ? <TableSkeleton cols={5} rows={3} /> : indexes.error && !indexes.data ? <ErrorState error={indexes.error} onRetry={indexes.reload} /> : indexItems.length === 0 ? <EmptyState title={t('adm.ix.empty')} message={t('adm.ix.emptyText')} /> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th scope="col">{t('adm.ix.alias')}</th><th scope="col">{t('adm.ix.index')}</th><th scope="col" className="num">{t('adm.ix.docs')}</th><th scope="col">{t('adm.ix.vectors')}</th><th scope="col">{t('adm.ix.embedders')}</th></tr></thead>
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
      <Card title={t('adm.ix.start')}>
        <div className="adm-job-buttons">
          {JOB_TYPES.map((j) => (
            <div key={j.type} className="adm-job-start">
              <button type="button" className="adm-btn adm-btn-primary" disabled={!!starting} onClick={() => start(j.type)}>
                {starting === j.type ? t('adm.ix.starting') : t(`adm.job.${j.type}.label`)}
              </button>
              <p className="adm-muted adm-small">{t(`adm.job.${j.type}.desc`)}</p>
            </div>
          ))}
        </div>
        {started && <Banner tone="good"><Link to={`/admin/jobs/${encodeURIComponent(started.id)}`}>{t('adm.ix.started', { id: started.id, type: started.type })}</Link></Banner>}
        {startError && <Banner tone="bad">{t('adm.ix.startFailed', { message: startError.message })}</Banner>}
      </Card>
      <Card
        title={t('adm.ix.jobs')}
        actions={(
          <span className="adm-muted adm-small" aria-live="polite">
            {jobs.status === 'polling' ? t('adm.ix.polling') : jobs.status === 'settled' ? t('adm.ix.upToDate') : ''}
            {' '}<button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={jobs.refresh}>{t('adm.refresh')}</button>
          </span>
        )}
      >
        {jobs.error && jobs.jobs.length > 0 && <Banner tone="warn">{t('adm.ix.refreshFailed', { message: jobs.error.message })}</Banner>}
        {jobs.status === 'loading' && jobs.jobs.length === 0 ? <TableSkeleton cols={5} /> : jobs.status === 'error' && jobs.jobs.length === 0 ? <ErrorState error={jobs.error} onRetry={jobs.refresh} /> : jobs.jobs.length === 0 ? <EmptyState title={t('adm.ix.noJobs')} message={t('adm.ix.noJobsText')} /> : <JobTable jobs={jobs.jobs} />}
      </Card>
    </>
  )
}
