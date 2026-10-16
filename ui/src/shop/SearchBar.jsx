import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { SEARCH_MODES, parseSearch, parseFilters, buildSearchUrl } from '../lib/urlState.js'
import { useImageSearch } from './ImageSearchContext.jsx'

export default function SearchBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { setImageFile } = useImageSearch()
  const fileInputRef = useRef(null)

  const [query, setQuery] = useState(() => {
    if (location.pathname === '/search') {
      const parsed = parseSearch(location.search)
      return parsed.type === 'text' ? parsed.query : ''
    }
    return ''
  })

  const [mode, setMode] = useState(() => {
    if (location.pathname === '/search') {
      const parsed = parseSearch(location.search)
      return parsed.mode || 'hybrid'
    }
    return 'hybrid'
  })

  const [fileError, setFileError] = useState(null)

  useEffect(() => {
    if (location.pathname === '/search') {
      const parsed = parseSearch(location.search)
      setQuery(parsed.type === 'text' ? parsed.query : '')
      setMode(parsed.mode || 'hybrid')
    } else {
      setQuery('')
    }
    setFileError(null)
  }, [location.pathname, location.search])

  function handleTextSubmit(event) {
    event.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return

    const targetUrl = buildSearchUrl({
      type: 'text',
      query: trimmed,
      mode,
      filters: parseFilters(location.search),
    })
    navigate(targetUrl)
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const isImage = Boolean(file.type?.startsWith('image/')) || (!file.type && /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name || ''))

    if (isImage) {
      setFileError(null)
      setImageFile(file)
      const targetUrl = buildSearchUrl({
        type: 'image',
        filters: parseFilters(location.search),
      })
      navigate(targetUrl)
    } else {
      setFileError('Choose a JPG, PNG, or WebP image.')
    }
  }

  return (
    <div className="search-bar-container">
      <form className="search-bar-form" role="search" onSubmit={handleTextSubmit}>
        <input
          type="text"
          className="search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (fileError) setFileError(null)
          }}
          placeholder="Search products…"
          aria-label="Search products"
        />

        <select
          className="search-mode-select"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          aria-label="Search mode"
        >
          {Object.entries(SEARCH_MODES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

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

        <button
          type="button"
          className="search-camera-button"
          aria-label="Search by image"
          title="Search by image"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>

        <button
          type="submit"
          className="search-submit-button"
          disabled={!query.trim()}
          aria-label="Search"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Search</span>
        </button>
      </form>

      {fileError && (
        <div className="search-bar-error" role="alert">
          {fileError}
        </div>
      )}
    </div>
  )
}
