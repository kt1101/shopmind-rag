import { describeError } from '../shared/api/errors.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'

export default function StatusBlock({ tone = 'empty', title, message, action, detail, children }) {
  const role = tone === 'error' ? 'alert' : tone === 'loading' ? 'status' : undefined

  return (
    <div className={`status-block ${tone}`} role={role}>
      {tone === 'loading' && <span className="status-spinner" aria-hidden="true" />}
      {title && <h3 className="status-title">{title}</h3>}
      {message && <p className="status-message">{message}</p>}
      {children}
      {action?.label && action?.onClick && (
        <button type="button" className="status-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {detail && (
        <details className="status-detail">
          <ErrorDetailSummary />
          <code>{detail}</code>
        </details>
      )}
    </div>
  )
}

function ErrorDetailSummary() {
  const { t } = useI18n()
  return <summary>{t('error.detail')}</summary>
}

// Error state in plain words (docs: errors.js). `context` is the page-specific headline, e.g.
// "Search failed"; the explanation and the retry button depend on the kind of error.
export function ErrorBlock({ error, onRetry, context }) {
  const { t } = useI18n()
  const info = describeError(error, t)
  return (
    <StatusBlock
      tone="error"
      title={context && info.kind !== 'llm_unavailable' ? context : info.title}
      message={context && info.kind !== 'llm_unavailable' ? `${info.title}. ${info.message}` : info.message}
      action={onRetry && info.retryable ? { label: t('state.retry'), onClick: onRetry } : undefined}
      detail={info.detail}
    />
  )
}
