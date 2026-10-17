import { useEffect, useState } from 'react'
import { getPipelines } from '../../api.js'
import { isSearchTrace, traceSummary } from '../../entities/trace/traceModel.js'
import Drawer from '../../shared/ui/Drawer.jsx'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { Skeleton } from '../../shared/ui/Skeleton.jsx'
import RagInspector from './RagInspector.jsx'
import SearchInspector from './SearchInspector.jsx'
import { formatMs } from './parts.jsx'
import './inspector.css'

let pipelinesPromise = null
function loadPipelines() {
  pipelinesPromise ||= getPipelines().then((res) => res?.data?.pipelines || []).catch(() => {
    pipelinesPromise = null
    return []
  })
  return pipelinesPromise
}

// Renders any trace: the Search Inspector for search kinds, the RAG Inspector otherwise.
// `view` forces 'search' or 'rag' (e.g. a chat trace whose intent was product_search).
export function TraceInspector({ trace, titles, view }) {
  if (!trace) return null
  const search = view === 'search' || (view !== 'rag' && isSearchTrace(trace))
  return search ? <SearchInspector trace={trace} titles={titles} /> : <RagInspector trace={trace} />
}

// Reusable glass-box drawer. Controlled: the caller supplies the trace (or loading/error).
// The admin Trace Explorer can mount it via InspectorHost (shopmind:open-inspector event).
export default function InspectorDrawer({ open, onClose, trace, loading = false, error = null, onRetry, titles, title, view }) {
  const { t } = useI18n()
  const [pipeline, setPipeline] = useState(null)
  const summary = traceSummary(trace)

  useEffect(() => {
    if (!open || !summary?.pipeline) return undefined
    let active = true
    loadPipelines().then((list) => {
      if (active) setPipeline(list.find((p) => p.name === summary.pipeline) || null)
    })
    return () => {
      active = false
    }
  }, [open, summary?.pipeline])

  const subtitle = summary ? (
    <>
      <span>{t('inspector.pipeline')}: <code>{summary.pipeline ?? '—'}</code>{pipeline?.description ? ` — ${pipeline.description}` : ''}</span>
      <span>{t('inspector.duration')}: <strong>{formatMs(summary.durationMs)}</strong></span>
      <span>{summary.stepCount} steps</span>
      <span>{t('inspector.traceId')}: <code>{summary.traceId}</code></span>
    </>
  ) : null

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title || (trace && view !== 'search' && !isSearchTrace(trace) ? t('inspector.ragTitle') : t('inspector.title'))}
      subtitle={subtitle}
      closeLabel={t('inspector.close')}
      width={820}
      className="insp-drawer"
    >
      {loading && !trace && (
        <div role="status" aria-live="polite">
          <p className="sm-muted">{t('inspector.loading')}</p>
          <Skeleton lines={8} />
        </div>
      )}
      {error && !trace && (
        <div className="insp-error" role="alert">
          <p><strong>{t('inspector.failed')}</strong> {error.message}</p>
          {onRetry && <button type="button" className="sm-button" onClick={onRetry}>{t('state.retry')}</button>}
        </div>
      )}
      {trace && <TraceInspector trace={trace} titles={titles} view={view} />}
    </Drawer>
  )
}
