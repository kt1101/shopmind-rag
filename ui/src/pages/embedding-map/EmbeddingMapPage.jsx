import { memo, useEffect, useMemo, useRef, useState } from 'react'
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

// The 1,500 dots only change with the data, the category focus or the top-k: memoized so
// hovering (which re-renders the page on every mouse move) does not rebuild them.
const MapDots = memo(function MapDots({ projected, colors, focusCategory, topSet }) {
  return projected.map((p) => {
    const top = topSet.has(p.product_id)
    const dim = (focusCategory && p.category !== focusCategory) || (topSet.size > 0 && !top)
    return (
      <circle
        key={p.product_id}
        cx={p.sx}
        cy={p.sy}
        r={top ? 6 : 3.6}
        fill={colors[p.category || 'other']}
        className={`emap-dot ${dim ? 'is-dim' : ''} ${top ? 'is-top' : ''}`}
      />
    )
  })
})

export default function EmbeddingMapPage() {
  const { t, lang } = useI18n()
  const [params, setParams] = useSearchParams()
  const space = SPACES.includes(params.get('space')) ? params.get('space') : 'text'
  const activeQuery = (params.get('q') || '').trim()

  const [map, setMap] = useState({ data: null, loading: true, error: null })
  const [reload, setReload] = useState(0)
  const [draft, setDraft] = useState(activeQuery)
  const [projection, setProjection] = useState({ point: null, loading: false, error: null })
  const [neighbours, setNeighbours] = useState({ ids: [], results: [], loading: false })
  const [hover, setHover] = useState(null)
  const [focusCategory, setFocusCategory] = useState(null)
  const svgRef = useRef(null)
  const frame = useRef(0)
  const query = { point: projection.point, ids: neighbours.ids, results: neighbours.results, loading: projection.loading || neighbours.loading, error: projection.error }

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

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

  // Project the query into the current space (re-runs when the space changes).
  useEffect(() => {
    if (!activeQuery) {
      setProjection({ point: null, loading: false, error: null })
      return undefined
    }
    const controller = new AbortController()
    setProjection((p) => ({ ...p, loading: true, error: null }))
    projectEmbedding({ space, query: activeQuery, signal: controller.signal })
      .then((proj) => {
        if (!controller.signal.aborted) setProjection({ point: proj?.data && Number.isFinite(proj.data.x) ? proj.data : null, loading: false, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') setProjection({ point: null, loading: false, error })
      })
    return () => controller.abort()
  }, [space, activeQuery])

  // The text-search top-k does not depend on the space: fetched once per query.
  useEffect(() => {
    if (!activeQuery) {
      setNeighbours({ ids: [], results: [], loading: false })
      return undefined
    }
    const controller = new AbortController()
    setNeighbours((n) => ({ ...n, loading: true }))
    searchText({ query: activeQuery, topK: TOP_K, filters: {}, signal: controller.signal })
      .then((search) => {
        if (controller.signal.aborted) return
        const results = search?.data?.results || []
        setNeighbours({ ids: results.map((r) => r.product_id), results, loading: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setNeighbours({ ids: [], results: [], loading: false })
      })
    return () => controller.abort()
  }, [activeQuery])

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

  const topSet = useMemo(() => new Set(neighbours.ids), [neighbours.ids])
  const topPoints = useMemo(() => view.projected.filter((p) => topSet.has(p.product_id)), [view.projected, topSet])
  const onMap = useMemo(() => new Set(view.projected.map((p) => p.product_id)), [view.projected])
  const ratio = useMemo(() => neighbourhoodRatio(points, projection.point, neighbours.ids), [points, projection.point, neighbours.ids])

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

  // Nearest-point lookup at most once per animation frame.
  function onMove(event) {
    const { clientX, clientY } = event
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const svg = svgRef.current
      if (!svg?.getScreenCTM || !svg.createSVGPoint) return
      const pt = svg.createSVGPoint()
      pt.x = clientX
      pt.y = clientY
      const ctm = svg.getScreenCTM()
      if (!ctm) return
      const local = pt.matrixTransform(ctm.inverse())
      const next = nearestPoint(view.projected, local.x, local.y, 12)
      setHover((current) => (current?.product_id === next?.product_id ? current : next))
    })
  }

  return (
    <div className="emap-page">
      <header className="emap-head">
        <div>
          <h1>{t('map.title')}</h1>
          <p className="sm-muted">{t('map.intro')}</p>
        </div>
        <Link to="/admin/playground" className="sm-button sm-button--small">{t('map.toPlayground')}</Link>
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
          <p className="adm-muted">{map.error.code === 'embedding_map_not_built' ? t('map.notBuilt') : map.error.message}</p>
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
              onMouseLeave={() => { cancelAnimationFrame(frame.current); setHover(null) }}
            >
              <rect x="0" y="0" width={WIDTH} height={HEIGHT} className="emap-bg" />
              <MapDots projected={view.projected} colors={view.colors} focusCategory={focusCategory} topSet={topSet} />
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
                    <li key={r.product_id} className={onMap.has(r.product_id) ? '' : 'is-off-map'}>
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
