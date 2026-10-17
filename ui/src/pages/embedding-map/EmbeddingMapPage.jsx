import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { getEmbeddingMap, projectEmbedding, searchText } from '../../api.js'
import { productPath } from '../../lib/urlState.js'
import { SPACES, categoryColors, categoryCounts, extent, makeScale, nearestPoint, neighbourhoodRatio } from '../../features/embedding-map/mapModel.js'
import { categoryLabel } from '../../shared/i18n.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { SkeletonBlock } from '../../shared/ui/Skeleton.jsx'
import './embedding-map.css'

const WIDTH = 820
const HEIGHT = 560
const TOP_K = 10

function Star({ x, y, r = 11 }) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const radius = i % 2 === 0 ? r : r * 0.45
    return `${(x + radius * Math.cos(angle)).toFixed(1)},${(y + radius * Math.sin(angle)).toFixed(1)}`
  })
  return <polygon points={pts.join(' ')} className="emap-query" />
}

export default function EmbeddingMapPage() {
  const { t, lang } = useI18n()
  const [params, setParams] = useSearchParams()
  const space = SPACES.includes(params.get('space')) ? params.get('space') : 'text'
  const activeQuery = (params.get('q') || '').trim()

  const [map, setMap] = useState({ data: null, loading: true, error: null })
  const [reload, setReload] = useState(0)
  const [draft, setDraft] = useState(activeQuery)
  const [query, setQuery] = useState({ point: null, ids: [], results: [], loading: false, error: null })
  const [hover, setHover] = useState(null)
  const [focusCategory, setFocusCategory] = useState(null)
  const svgRef = useRef(null)

  useEffect(() => setDraft(activeQuery), [activeQuery])

  useEffect(() => {
    const controller = new AbortController()
    setMap((m) => ({ ...m, loading: true, error: null }))
    getEmbeddingMap({ space, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setMap({ data: res?.data || null, loading: false, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') setMap({ data: null, loading: false, error })
      })
    return () => controller.abort()
  }, [space, reload])

  // Project the query into the current space and fetch the top-k of a text search.
  useEffect(() => {
    if (!activeQuery) {
      setQuery({ point: null, ids: [], results: [], loading: false, error: null })
      return undefined
    }
    const controller = new AbortController()
    setQuery((q) => ({ ...q, loading: true, error: null }))
    Promise.all([
      projectEmbedding({ space, query: activeQuery, signal: controller.signal }),
      searchText({ query: activeQuery, topK: TOP_K, filters: {}, signal: controller.signal }).catch(() => ({ data: { results: [] } })),
    ])
      .then(([proj, search]) => {
        if (controller.signal.aborted) return
        const results = search?.data?.results || []
        setQuery({ point: proj?.data && Number.isFinite(proj.data.x) ? proj.data : null, ids: results.map((r) => r.product_id), results, loading: false, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') setQuery({ point: null, ids: [], results: [], loading: false, error })
      })
    return () => controller.abort()
  }, [space, activeQuery])

  const points = map.data?.points
  const view = useMemo(() => {
    const list = Array.isArray(points) ? points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) : []
    const box = extent(list, query.point ? [query.point] : [])
    const scale = makeScale(box, WIDTH, HEIGHT, 16)
    const colors = categoryColors(list)
    return {
      colors,
      counts: categoryCounts(list),
      projected: list.map((p) => ({ ...p, sx: scale.x(p.x), sy: scale.y(p.y) })),
      queryXY: query.point ? { sx: scale.x(query.point.x), sy: scale.y(query.point.y) } : null,
    }
  }, [points, query.point])

  const topSet = useMemo(() => new Set(query.ids), [query.ids])
  const topPoints = view.projected.filter((p) => topSet.has(p.product_id))
  const ratio = neighbourhoodRatio(points, query.point, query.ids)

  function setSpace(next) {
    const p = new URLSearchParams(params)
    p.set('space', next)
    setParams(p, { replace: true })
  }

  function submit(event) {
    event.preventDefault()
    const p = new URLSearchParams(params)
    if (draft.trim()) p.set('q', draft.trim())
    else p.delete('q')
    setParams(p)
  }

  function onMove(event) {
    const svg = svgRef.current
    if (!svg?.getScreenCTM || !svg.createSVGPoint) return
    const pt = svg.createSVGPoint()
    pt.x = event.clientX
    pt.y = event.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const local = pt.matrixTransform(ctm.inverse())
    setHover(nearestPoint(view.projected, local.x, local.y, 12))
  }

  return (
    <div className="emap-page">
      <header className="emap-head">
        <div>
          <h1>{t('map.title')}</h1>
          <p className="sm-muted">{t('map.intro')}</p>
        </div>
        <Link to="/admin/playground" className="sm-button sm-button--small">Search Playground →</Link>
      </header>

      <div className="emap-controls">
        <div className="emap-spaces" role="radiogroup" aria-label={t('map.space')}>
          {SPACES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={space === s} className={`emap-space ${space === s ? 'is-active' : ''}`} onClick={() => setSpace(s)}>
              {t(`map.space.${s}`)}
            </button>
          ))}
        </div>
        <form className="emap-query-form" onSubmit={submit} role="search">
          <label htmlFor="emap-q" className="sr-only">{t('map.query')}</label>
          <input id="emap-q" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('map.queryPlaceholder')} />
          <button type="submit" className="sm-button sm-button--primary" disabled={query.loading}>{t('map.project')}</button>
        </form>
      </div>

      {map.error ? (
        <div className="adm-state adm-state-error" role="alert">
          <p className="adm-state-title">{t('map.failed')}</p>
          <p className="adm-muted">{map.error.message}{map.error.code === 'embedding_map_not_built' ? ' (run the build_embedding_map job on Indexes & Jobs)' : ''}</p>
          <button type="button" className="adm-btn" onClick={() => setReload((n) => n + 1)}>{t('state.retry')}</button>
        </div>
      ) : map.loading && !map.data ? (
        <div role="status" aria-label={t('map.loading')}><SkeletonBlock height={420} /></div>
      ) : (
        <div className="emap-layout">
          <figure className={`emap-figure ${map.loading ? 'is-loading' : ''}`}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="emap-svg"
              role="img"
              aria-label={t('map.ariaLabel', { count: view.projected.length })}
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            >
              <rect x="0" y="0" width={WIDTH} height={HEIGHT} className="emap-bg" />
              {view.projected.map((p) => {
                const dim = (focusCategory && p.category !== focusCategory) || (topSet.size > 0 && !topSet.has(p.product_id))
                return (
                  <circle
                    key={p.product_id}
                    cx={p.sx}
                    cy={p.sy}
                    r={topSet.has(p.product_id) ? 6 : 3.6}
                    fill={view.colors[p.category || 'other']}
                    className={`emap-dot ${dim ? 'is-dim' : ''} ${topSet.has(p.product_id) ? 'is-top' : ''}`}
                  />
                )
              })}
              {view.queryXY && topPoints.map((p) => (
                <line key={`l-${p.product_id}`} x1={view.queryXY.sx} y1={view.queryXY.sy} x2={p.sx} y2={p.sy} className="emap-link" />
              ))}
              {view.queryXY && <Star x={view.queryXY.sx} y={view.queryXY.sy} />}
              {hover && <circle cx={hover.sx} cy={hover.sy} r="8" className="emap-hover-ring" />}
            </svg>
            {hover && (
              <div className="emap-tooltip" style={{ left: `${(hover.sx / WIDTH) * 100}%`, top: `${(hover.sy / HEIGHT) * 100}%` }} role="tooltip">
                <strong>{hover.title}</strong>
                <span>{categoryLabel(lang, hover.category)} · <code>{hover.product_id}</code></span>
              </div>
            )}
            <figcaption className="sm-muted sm-small">
              {t('map.points', { count: view.projected.length, projection: map.data?.projection || 'pca' })}
              {ratio != null && <> · {t('map.ratio', { k: query.ids.length, ratio })}</>}
            </figcaption>
          </figure>

          <aside className="emap-side">
            <section>
              <h2 className="emap-h2">{t('map.legend')}</h2>
              <ul className="emap-legend">
                {view.counts.map(({ category, count }) => (
                  <li key={category}>
                    <button type="button" aria-pressed={focusCategory === category} onClick={() => setFocusCategory((c) => (c === category ? null : category))}>
                      <span className="emap-swatch" style={{ background: view.colors[category] }} aria-hidden="true" />
                      <span className="emap-legend-label">{categoryLabel(lang, category)}</span>
                      <span className="sm-muted">{count}</span>
                    </button>
                  </li>
                ))}
                {view.queryXY && <li className="emap-legend-query"><svg width="16" height="16" aria-hidden="true"><Star x={8} y={8} r={7} /></svg> {t('map.queryPoint')}</li>}
              </ul>
            </section>
            {activeQuery && (
              <section aria-busy={query.loading}>
                <h2 className="emap-h2">{t('map.topk', { k: TOP_K })}</h2>
                {query.error && <p className="sm-small" role="alert">{query.error.message}</p>}
                <ol className="emap-results">
                  {query.results.map((r) => (
                    <li key={r.product_id} className={topSet.has(r.product_id) && view.projected.some((p) => p.product_id === r.product_id) ? '' : 'is-off-map'}>
                      <Link to={productPath(r.product_id)}>{r.title}</Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
