import { useEffect, useRef, useState } from 'react'
import { humanizeCategory } from '../lib/format.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'

export default function FilterField({
  field,
  config = {},
  value,
  draft = '',
  options = [],
  loading = false,
  error = null,
  onFocus,
  onDraftChange,
  onSelect,
  onRemove,
}) {
  const { t } = useI18n()
  const fieldRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const selected = config.multiple ? (Array.isArray(value) ? value : value ? [value] : []) : (value ? [value] : [])
  const visibleOptions = (options || []).filter((option) => !selected.includes(option.value))

  useEffect(() => {
    if (!open) return undefined
    const closeWhenOutside = (event) => {
      if (!fieldRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', closeWhenOutside)
    return () => document.removeEventListener('mousedown', closeWhenOutside)
  }, [open])

  function choose(option) {
    onSelect?.(field, option.value)
    setOpen(false)
    setActiveIndex(-1)
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((index) => Math.min(index + 1, visibleOptions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (open && visibleOptions[activeIndex]) choose(visibleOptions[activeIndex])
      else if (draft && draft.trim()) choose({ value: draft.trim() })
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActiveIndex(-1)
    }
  }

  const formatLabel = (val) => (field === 'category' ? humanizeCategory(val) : val)

  return (
    <div className="filter-field" ref={fieldRef}>
      <label>
        <span>{config.label}</span>
        <input
          value={draft}
          placeholder={config.placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${field}-filter-options`}
          aria-autocomplete="list"
          onFocus={() => {
            onFocus?.(field)
            setOpen(true)
          }}
          onChange={(event) => {
            onDraftChange?.(field, event.target.value)
            setOpen(true)
            setActiveIndex(-1)
          }}
          onKeyDown={handleKeyDown}
        />
      </label>
      {selected.length > 0 && (
        <div className="filter-chips" aria-label={`Selected ${config.label}`}>
          {selected.map((item) => (
            <button
              className="filter-chip"
              type="button"
              key={item}
              onClick={() => onRemove?.(field, item)}
              title={`Remove ${item}`}
            >
              {formatLabel(item)} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="filter-options" id={`${field}-filter-options`} role="listbox">
          {loading && <span className="filter-status">{t('filters.loadingOptions')}</span>}
          {!loading && error && <span className="filter-status error">{error}</span>}
          {!loading && !error && visibleOptions.length === 0 && (
            <span className="filter-status">{t('filters.noSuggestions')}</span>
          )}
          {!loading && !error && visibleOptions.map((option, index) => (
            <button
              className={index === activeIndex ? 'filter-option active' : 'filter-option'}
              type="button"
              role="option"
              aria-selected={false}
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span>{formatLabel(option.value)}</span>
              <small>{option.count}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
