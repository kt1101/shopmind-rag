import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { resolveImageUrl, searchSuggest } from '../api.js'
import { SEARCH_MODES, buildSearchUrl, parseFilters, parseSearch } from '../lib/urlState.js'
import { SUGGEST_DEBOUNCE_MS, moveHighlight, orderSuggestions, shouldSuggest, suggestionHref } from '../features/search-bar/suggest.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import { useImageSearch } from './ImageSearchContext.jsx'

function isImageFile(file) {
  return Boolean(file?.type?.startsWith('image/')) || (!file?.type && /\.(jpe?g|png|webp|gif|avif)$/i.test(file?.name || ''))
}

function useObjectUrl(file) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== 'function') {
      setUrl(null)
      return undefined
    }
    let created = null
    try {
      created = URL.createObjectURL(file)
      setUrl(created)
    } catch {
      setUrl(null)
    }
    return () => {
      try {
        if (created) URL.revokeObjectURL(created)
      } catch {
        // ignore
      }
    }
  }, [file])
  return url
}

export default function SearchBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { t } = useI18n()
  const { imageFile, setImageFile } = useImageSearch()
  const fileInputRef = useRef(null)
  const inputRef = useRef(null)
  const listId = useId()
  const thumbUrl = useObjectUrl(imageFile)

  const current = useMemo(() => (location.pathname === '/search' ? parseSearch(location.search) : null), [location.pathname, location.search])
  const [query, setQuery] = useState(current?.type === 'text' || current?.type === 'compose' ? current.query : '')
  const [mode, setMode] = useState(current?.mode || 'hybrid')
  const [fileError, setFileError] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [typed, setTyped] = useState(false)

  useEffect(() => {
    setQuery(current?.type === 'text' || current?.type === 'compose' ? current.query : '')
    setMode(current?.mode || 'hybrid')
    setFileError(null)
    setOpen(false)
    setTyped(false)
  }, [current])

  // Debounced autocomplete, only while the user is typing.
  useEffect(() => {
    if (!typed || !shouldSuggest(query)) {
      setSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchSuggest({ q: query, limit: 8, signal: controller.signal })
        .then((res) => {
          if (controller.signal.aborted) return
          setSuggestions(orderSuggestions(res?.data?.suggestions))
          setHighlight(-1)
          setOpen(true)
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([])
        })
    }, SUGGEST_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, typed])

  function go(url) {
    setOpen(false)
    setTyped(false)
    navigate(url)
  }

  function submit(event) {
    event?.preventDefault()
    const trimmed = query.trim()
    const filters = parseFilters(location.search)
    if (imageFile && trimmed) {
      go(buildSearchUrl({ type: 'compose', query: trimmed, filters, alpha: current?.alpha }))
    } else if (imageFile) {
      go(buildSearchUrl({ type: 'image', filters }))
    } else if (trimmed) {
      go(buildSearchUrl({ type: 'text', query: trimmed, mode, filters }))
    }
  }

  function pickSuggestion(s) {
    const href = suggestionHref(s)
    if (href) go(href)
  }

  function onKeyDown(event) {
    if (!open || !suggestions.length) {
      if (event.key === 'ArrowDown' && suggestions.length) {
        setOpen(true)
        setHighlight(0)
        event.preventDefault()
      }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => moveHighlight(h, event.key === 'ArrowDown' ? 1 : -1, suggestions.length))
    } else if (event.key === 'Enter' && highlight >= 0) {
      event.preventDefault()
      pickSuggestion(suggestions[highlight])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      setHighlight(-1)
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!isImageFile(file)) {
      setFileError(t('search.badFile'))
      return
    }
    setFileError(null)
    setImageFile(file)
    const filters = parseFilters(location.search)
    const trimmed = query.trim()
    go(trimmed ? buildSearchUrl({ type: 'compose', query: trimmed, filters }) : buildSearchUrl({ type: 'image', filters }))
  }

  function removeImage() {
    setImageFile(null)
    inputRef.current?.focus()
    if (current?.type === 'compose' && current.query) {
      go(buildSearchUrl({ type: 'text', query: current.query, mode, filters: current.filters }))
    }
  }

  const showList = open && suggestions.length > 0
  const activeId = highlight >= 0 ? `${listId}-opt-${highlight}` : undefined
  const canSubmit = Boolean(query.trim() || imageFile)

  return (
    <div className="search-bar-container">
      <form className={`search-bar-form ${imageFile ? 'has-image' : ''}`} role="search" onSubmit={submit}>
        {imageFile && (
          <span className="search-image-chip">
            {thumbUrl ? <img src={thumbUrl} alt={t('chat.imageAlt')} /> : <span aria-hidden="true">🖼</span>}
            <button type="button" className="search-image-chip-remove" aria-label={t('search.removeImage')} onClick={removeImage}>×</button>
          </span>
        )}
        <div className="search-combobox">
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setTyped(true)
              if (fileError) setFileError(null)
            }}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            placeholder={imageFile ? t('search.placeholderCompose') : t('search.placeholder')}
            aria-label={t('search.label')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showList}
            aria-controls={listId}
            aria-activedescendant={activeId}
            autoComplete="off"
          />
          {showList && (
            <ul id={listId} role="listbox" className="search-suggest" aria-label={t('search.suggestions')}>
              {suggestions.map((s, index) => {
                const img = s.type === 'product' ? resolveImageUrl(s.image_url) : null
                return (
                  <li
                    key={`${s.type}:${s.product_id ?? s.value}`}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={index === highlight}
                    className={`search-suggest-item ${index === highlight ? 'is-active' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => pickSuggestion(s)}
                  >
                    <span className="search-suggest-thumb" aria-hidden="true">{img ? <img src={img} alt="" /> : s.type === 'brand' ? '®' : s.type === 'category' ? '▦' : '◇'}</span>
                    <span className="search-suggest-label">{s.label}</span>
                    <span className="search-suggest-type">{t(`suggest.${s.type}`)}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {!imageFile && (
          <select className="search-mode-select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label={t('search.mode')}>
            {Object.keys(SEARCH_MODES).map((key) => (
              <option key={key} value={key}>{t(`mode.${key}`)}</option>
            ))}
          </select>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/*"
          className="search-file-input"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          tabIndex={-1}
          aria-hidden="true"
        />

        <button type="button" className="search-camera-button" aria-label={t('search.byImage')} title={t('search.byImage')} onClick={() => fileInputRef.current?.click()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>

        <button type="submit" className="search-submit-button" disabled={!canSubmit} aria-label={t('search.submit')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>{t('search.submit')}</span>
        </button>
      </form>

      {imageFile && !fileError && <div className="search-bar-hint">{t('search.imageAttached')}</div>}
      {fileError && <div className="search-bar-error" role="alert">{fileError}</div>}
    </div>
  )
}
