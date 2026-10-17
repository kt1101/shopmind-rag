import { useId, useRef } from 'react'
import './ui.css'

// Accessible tabs (WAI-ARIA pattern): arrow keys / Home / End move between tabs.
// `tabs` = [{id, label, badge?}], controlled by `value` + `onChange`.
export default function Tabs({ tabs, value, onChange, label, children }) {
  const baseId = useId()
  const listRef = useRef(null)

  function focusTab(index) {
    const next = tabs[(index + tabs.length) % tabs.length]
    onChange(next.id)
    listRef.current?.querySelector(`[data-tab="${next.id}"]`)?.focus()
  }

  function onKeyDown(event) {
    const index = tabs.findIndex((tab) => tab.id === value)
    if (event.key === 'ArrowRight') focusTab(index + 1)
    else if (event.key === 'ArrowLeft') focusTab(index - 1)
    else if (event.key === 'Home') focusTab(0)
    else if (event.key === 'End') focusTab(tabs.length - 1)
    else return
    event.preventDefault()
  }

  return (
    <div className="sm-tabs">
      <div className="sm-tablist" role="tablist" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-tab={tab.id}
            id={`${baseId}-tab-${tab.id}`}
            aria-selected={tab.id === value}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab.id === value ? 0 : -1}
            className="sm-tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.badge != null && <span className="sm-tab-badge">{tab.badge}</span>}
          </button>
        ))}
      </div>
      <div className="sm-tabpanel" role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${value}`} tabIndex={0}>
        {children}
      </div>
    </div>
  )
}
