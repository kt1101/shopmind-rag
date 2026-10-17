import { useEffect, useId, useRef } from 'react'
import './ui.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Right-side modal drawer: Escape and backdrop close it, focus moves in on open, Tab is
// kept inside, and focus returns to the opener on close.
export default function Drawer({ open, onClose, title, subtitle, children, width = 760, closeLabel = 'Close', className = '', ...rest }) {
  const panelRef = useRef(null)
  const openerRef = useRef(null)
  const titleId = useId()
  // Callers usually pass an inline onClose. Reading it through a ref keeps the effect below
  // tied to `open` only, so a parent re-render (a trace arriving, a streamed chat token) does
  // not re-run it and yank focus back to the close button.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    openerRef.current = document.activeElement
    const panel = panelRef.current
    const autofocus = panel?.querySelector('[data-autofocus]')
    if (autofocus) autofocus.focus()
    else panel?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = overflow
      const opener = openerRef.current
      if (opener?.isConnected) opener.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="sm-drawer-root">
      <div className="sm-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <section
        ref={panelRef}
        className={`sm-drawer ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ '--drawer-width': `${width}px` }}
        {...rest}
      >
        <header className="sm-drawer-header">
          <div>
            <h2 id={titleId} className="sm-drawer-title">{title}</h2>
            {subtitle && <div className="sm-drawer-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="sm-icon-button" onClick={onClose} aria-label={closeLabel} data-autofocus="">×</button>
        </header>
        <div className="sm-drawer-body">{children}</div>
      </section>
    </div>
  )
}
