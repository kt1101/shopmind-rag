import { useEffect, useRef } from 'react'

export function PageHeader({ title, description, actions }) {
  return (
    <header className="adm-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="adm-muted">{description}</p>}
      </div>
      {actions && <div className="adm-page-actions">{actions}</div>}
    </header>
  )
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`adm-card ${className}`}>
      {(title || actions) && (
        <div className="adm-card-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="adm-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Skeleton({ lines = 5, height = 18 }) {
  return (
    <div className="adm-skeleton" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="adm-skeleton-line" style={{ height, width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 4 }) {
  return (
    <div className="adm-table-wrap" role="status" aria-label="Loading">
      <table className="adm-table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}><span className="adm-skeleton-line" style={{ width: `${60 + ((r + c) % 3) * 15}%` }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EmptyState({ title = 'Nothing here yet', message, action }) {
  return (
    <div className="adm-state adm-state-empty">
      <p className="adm-state-title">{title}</p>
      {message && <p className="adm-muted">{message}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry, title = 'Could not load data' }) {
  return (
    <div className="adm-state adm-state-error" role="alert">
      <p className="adm-state-title">{title}</p>
      <p className="adm-muted">{error?.message || String(error || 'Unknown error')}{error?.status ? ` (HTTP ${error.status})` : ''}</p>
      {onRetry && <button type="button" className="adm-btn" onClick={onRetry}>Retry</button>}
    </div>
  )
}

// Standard loading / error / empty switch for a list.
export function AsyncBlock({ loading, error, empty, onRetry, skeleton, emptyState, children, hasData }) {
  if (loading && !hasData) return skeleton || <Skeleton />
  if (error && !hasData) return <ErrorState error={error} onRetry={onRetry} />
  if (empty) return emptyState || <EmptyState />
  return children
}

const PILL_TONES = {
  queued: 'neutral', running: 'info', succeeded: 'good', failed: 'bad',
  draft: 'warn', published: 'good', active: 'good',
  search: 'info', image_search: 'info', compose_search: 'info', rag: 'accent', chat: 'accent', compare: 'accent', plan: 'accent',
  a1: 'info', a3: 'accent', answer: 'accent',
}

export function Pill({ value, tone, children }) {
  const t = tone || PILL_TONES[value] || 'neutral'
  return (
    <span className={`adm-pill adm-pill-${t}`}>
      {value === 'running' && <span className="adm-pill-dot" aria-hidden="true" />}
      {children ?? value}
    </span>
  )
}

export function Pagination({ total, limit, offset, onChange }) {
  if (!total || total <= limit) return total ? <p className="adm-muted adm-pager-info">{total} item{total === 1 ? '' : 's'}</p> : null
  const page = Math.floor(offset / limit) + 1
  const pages = Math.ceil(total / limit)
  return (
    <nav className="adm-pager" aria-label="Pagination">
      <button type="button" className="adm-btn adm-btn-ghost" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</button>
      <span className="adm-muted">Page {page} of {pages} · {total} items</span>
      <button type="button" className="adm-btn adm-btn-ghost" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Next</button>
    </nav>
  )
}

export function Modal({ open, title, onClose, children, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } else if (!open && dialog.open) {
      dialog.close?.()
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      className={`adm-modal ${wide ? 'adm-modal-wide' : ''}`}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
    >
      {open && (
        <div className="adm-modal-body">
          <div className="adm-modal-head">
            <h2>{title}</h2>
            <button type="button" className="adm-btn adm-btn-ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function JsonView({ value }) {
  return <pre className="adm-json">{JSON.stringify(value, null, 2)}</pre>
}

export function Banner({ tone = 'info', children }) {
  return <div className={`adm-banner adm-banner-${tone}`} role={tone === 'bad' ? 'alert' : 'note'}>{children}</div>
}
