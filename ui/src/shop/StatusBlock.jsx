export default function StatusBlock({ tone = 'empty', title, message, action }) {
  const role = tone === 'error' ? 'alert' : tone === 'loading' ? 'status' : undefined

  return (
    <div className={`status-block ${tone}`} role={role}>
      {tone === 'loading' && <span className="status-spinner" aria-hidden="true" />}
      {title && <h3 className="status-title">{title}</h3>}
      {message && <p className="status-message">{message}</p>}
      {action?.label && action?.onClick && (
        <button type="button" className="status-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  )
}
