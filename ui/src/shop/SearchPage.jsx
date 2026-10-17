import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { searchCompose, searchImage, searchSuggest, searchText, sendClick, understandQuery } from '../api.js'
import { buildCatalogUrl, buildSearchUrl, hasActiveFilters, parseSearch } from '../lib/urlState.js'
import { applyUnderstood, buildSearchCall, pendingUnderstood } from '../features/search/searchCall.js'
import { didYouMean, fallbackTerms } from '../features/search-bar/suggest.js'
import AlphaControl from '../features/compose/AlphaControl.jsx'
import FeedbackWidget from '../features/feedback/FeedbackWidget.jsx'
import InspectorDrawer from '../widgets/inspector/InspectorDrawer.jsx'
import { categoryLabel, colorLabel } from '../shared/i18n.js'
import { useStaffMode } from '../shared/lib/useStaffMode.js'
import { useI18n } from '../shared/ui/I18nProvider.jsx'
import FilterSidebar from './FilterSidebar.jsx'
import { useImageSearch } from './ImageSearchContext.jsx'
import ProductGrid from './ProductGrid.jsx'
import StatusBlock, { ErrorBlock } from './StatusBlock.jsx'
import '../features/feedback/feedback.css'

const API = { text: searchText, image: searchImage, compose: searchCompose }

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

function filterLabel(lang, field, value) {
  if (field === 'category') return categoryLabel(lang, value)
  if (field === 'color') return colorLabel(lang, value)
  return value
}

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { imageFile, setImageFile } = useImageSearch()
  const staff = useStaffMode()
  const fileInputRef = useRef(null)
  const thumbnailUrl = useObjectUrl(imageFile)

  const search = useMemo(() => parseSearch(searchParams), [searchParams])
  const fileKey = imageFile ? `${imageFile.name}|${imageFile.size}|${imageFile.lastModified ?? ''}` : ''
  const searchKey = `${searchParams.toString()}#${search.type === 'text' ? '' : fileKey}`

  const [response, setResponse] = useState(null)
  const [durationMs, setDurationMs] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadIndex, setReloadIndex] = useState(0)
  const [understood, setUnderstood] = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [inspector, setInspector] = useState({ open: false, trace: null, loading: false, error: null, key: null })
  const traceCache = useRef(new Map())

  const items = response?.results || []

  // Main search request.
  useEffect(() => {
    const call = buildSearchCall(search, imageFile)
    if (!call) {
      setResponse(null)
      setLoading(false)
      setError(null)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    API[call.kind]({ ...call.args, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        setResponse(res?.data || null)
        setDurationMs(res?.durationMs ?? null)
        if (res?.data?.trace) traceCache.current.set(searchKey, res.data.trace)
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') {
          setError(err)
          setResponse(null)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // searchKey covers search + image identity
  }, [searchKey, reloadIndex])

  // F2: query understanding banner (from the response, else POST /search/understand).
  useEffect(() => {
    setUnderstood(null)
    if (search.type !== 'text' || loading) return undefined
    if (response?.understood) {
      setUnderstood(response.understood)
      return undefined
    }
    if (search.query.split(/\s+/).length < 2) return undefined
    const controller = new AbortController()
    understandQuery({ query: search.query, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setUnderstood(res?.data || null)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [response, loading, search.type, search.query])

  // "Có phải bạn muốn tìm…" on zero results.
  useEffect(() => {
    setSuggestions([])
    if (search.type !== 'text' || loading || error || items.length > 0) return undefined
    const controller = new AbortController()
    ;(async () => {
      const found = []
      for (const q of [search.query, ...fallbackTerms(search.query)]) {
        try {
          const res = await searchSuggest({ q, limit: 6, signal: controller.signal })
          found.push(...(res?.data?.suggestions || []))
        } catch {
          // ignore
        }
        if (controller.signal.aborted) return
        if (found.length >= 4) break
      }
      if (!controller.signal.aborted) setSuggestions(didYouMean(search.query, found))
    })()
    return () => controller.abort()
  }, [loading, error, items.length, search.type, search.query])

  // Inspector: use the inline trace when present, otherwise re-run with explain=true.
  const loadTrace = useCallback((key) => {
    const cached = traceCache.current.get(key)
    if (cached) {
      setInspector((s) => ({ ...s, trace: cached, loading: false, error: null, key }))
      return undefined
    }
    const call = buildSearchCall(search, imageFile, { explain: true })
    if (!call) return undefined
    const controller = new AbortController()
    setInspector((s) => ({ ...s, trace: null, loading: true, error: null, key }))
    API[call.kind]({ ...call.args, signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return
        const trace = res?.data?.trace || null
        if (trace) traceCache.current.set(key, trace)
        setInspector((s) => ({ ...s, trace, loading: false, error: trace ? null : new Error(t('inspector.noTrace')) }))
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'AbortError') setInspector((s) => ({ ...s, loading: false, error: err }))
      })
    return controller
  }, [search, imageFile])

  useEffect(() => {
    if (!inspector.open) return undefined
    const controller = loadTrace(searchKey)
    return () => controller?.abort()
  }, [inspector.open, searchKey])

  function go(next) {
    navigate(buildSearchUrl({ ...search, ...next }))
  }

  function removeFilter(field, value) {
    go({ filters: { ...search.filters, [field]: search.filters[field].filter((v) => v !== value) } })
  }

  function handleFileSelect(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file && (file.type?.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name || ''))) setImageFile(file)
  }

  function onOpen(product, rank) {
    if (response?.trace_id) sendClick({ traceId: response.trace_id, productId: product.product_id, rank }).catch(() => {})
  }

  if (search.type === null) {
    return <Navigate to={buildCatalogUrl(search.filters)} replace />
  }

  const filtersActive = hasActiveFilters(search.filters)
  const pending = pendingUnderstood(understood, search.filters)
  const titles = Object.fromEntries(items.map((p) => [p.product_id, p.title]))
  // Shoppers see what kind of search ran, never the algorithm; staff also see the pipeline name.
  const modeLabel = search.type === 'image' ? t('mode.image') : search.type === 'compose' ? t('mode.compose') : null
  const pipelineName = staff.active ? response?.pipeline || response?.trace?.pipeline || null : null
  const needsImage = (search.type === 'image' || search.type === 'compose') && !imageFile

  return (
    <div className="search-page shop-columns">
      <FilterSidebar
        filters={search.filters}
        onChange={(filters) => go({ filters })}
        query={search.type === 'text' ? search.query : null}
        showColor={search.type === 'text'}
      />

      <div className="search-content">
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden onChange={handleFileSelect} tabIndex={-1} aria-hidden="true" />

        {needsImage ? (
          <StatusBlock
            tone="empty"
            title={t('results.noImage')}
            message={t('results.noImageHint')}
            action={{ label: t('results.selectImage'), onClick: () => fileInputRef.current?.click() }}
          />
        ) : (
          <>
            <div className="search-toolbar">
              <div className="search-toolbar-main">
                <div className="search-query-info">
                  <h1 className="search-title">
                    {search.type !== 'text' && thumbnailUrl && <img src={thumbnailUrl} alt={t('chat.imageAlt')} className="search-thumbnail" />}
                    <span>
                      {search.type === 'text' && t('results.for', { query: search.query })}
                      {search.type === 'image' && t('results.image')}
                      {search.type === 'compose' && t('results.compose', { query: search.query })}
                    </span>
                  </h1>
                </div>
                <div className="search-meta">
                  {modeLabel && <span className="search-meta-mode">{modeLabel}</span>}
                  {pipelineName && <code className="search-meta-pipeline" title={t('staff.pipelineHint')}>{pipelineName}</code>}
                  {durationMs != null && !loading && !error && (
                    <>
                      {(modeLabel || pipelineName) && <span className="search-meta-dot" aria-hidden="true">·</span>}
                      <span className="search-meta-count">{t('results.count', { count: items.length })}</span>
                      <span className="search-meta-dot" aria-hidden="true">·</span>
                      <span className="search-meta-duration">{t('results.ms', { ms: durationMs })}</span>
                    </>
                  )}
                  {staff.active && response?.trace_id && (
                    <button type="button" className="search-why-button" onClick={() => setInspector((s) => ({ ...s, open: true }))}>
                      <span aria-hidden="true">🔍</span> {t('results.why')}
                    </button>
                  )}
                </div>
              </div>

              {filtersActive && (
                <div className="search-active-filters" aria-label={t('results.activeFilters')}>
                  {['category', 'brand', 'color'].flatMap((field) => search.filters[field].map((value) => (
                    <span key={`${field}-${value}`} className="search-chip">
                      <span className="search-chip-label">{filterLabel(lang, field, value)}</span>
                      <button type="button" className="search-chip-remove" aria-label={t('results.removeFilter', { value: filterLabel(lang, field, value) })} onClick={() => removeFilter(field, value)}>×</button>
                    </span>
                  )))}
                  <button type="button" className="search-clear-all" onClick={() => go({ filters: { category: [], brand: [], color: [] } })}>{t('results.clearFilters')}</button>
                </div>
              )}

              {pending.length > 0 && (
                <div className="search-understood" role="note">
                  <span className="search-understood-label">{t('results.understood')}</span>
                  {pending.map(({ field, values }) => values.map((value) => (
                    <span key={`${field}-${value}`} className="sm-badge sm-badge--accent">{t(`filters.${field}`)}: {filterLabel(lang, field, value)}</span>
                  )))}
                  <button type="button" className="sm-button sm-button--small" onClick={() => go({ filters: applyUnderstood(search.filters, pending) })}>{t('results.applyFilters')}</button>
                </div>
              )}
            </div>

            {search.type === 'compose' && (
              <AlphaControl value={search.alpha} busy={loading} onChange={(alpha) => navigate(buildSearchUrl({ ...search, alpha }), { replace: true })} />
            )}

            {loading && !items.length ? (
              <ProductGrid products={[]} loading skeletonCount={8} />
            ) : error ? (
              <ErrorBlock error={error} context={t('results.failed')} onRetry={() => setReloadIndex((i) => i + 1)} />
            ) : !loading && items.length === 0 ? (
              <div className="search-empty">
                <StatusBlock
                  tone="empty"
                  title={t('results.empty')}
                  message={t('results.emptyHint')}
                  action={filtersActive ? { label: t('results.clearFilters'), onClick: () => go({ filters: { category: [], brand: [], color: [] } }) } : undefined}
                />
                {suggestions.length > 0 && (
                  <nav className="search-did-you-mean" aria-label={t('results.didYouMean')}>
                    <span>{t('results.didYouMean')}</span>
                    <ul>
                      {suggestions.map((s) => <li key={s.href}><Link to={s.href}>{s.label}</Link></li>)}
                    </ul>
                  </nav>
                )}
              </div>
            ) : (
              <div className={loading ? 'search-results is-refreshing' : 'search-results'}>
                <ProductGrid products={items} onOpen={onOpen} />
              </div>
            )}

            {!loading && !error && response?.trace_id && (
              <div className="search-feedback">
                <FeedbackWidget target="search" traceId={response.trace_id} query={search.type === 'image' ? '[image]' : search.query} />
              </div>
            )}
          </>
        )}
      </div>

      {staff.active && <InspectorDrawer
        open={inspector.open}
        onClose={() => setInspector((s) => ({ ...s, open: false }))}
        trace={inspector.trace}
        loading={inspector.loading}
        error={inspector.error}
        onRetry={() => {
          traceCache.current.delete(searchKey)
          loadTrace(searchKey)
        }}
        titles={titles}
      />}
    </div>
  )
}
