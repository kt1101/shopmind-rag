import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { exportJudgments, getAgreement, listJudgments, saveJudgment, searchForAnnotation } from '../../../shared/api/admin.js'
import { useAsync } from '../lib/useAsync.js'
import { GRADES, annotationReducer, gradesFromJudgments, initialAnnotationState, keyToAction, progress } from '../lib/annotation.js'
import { formatKappa } from '../lib/format.js'
import { Banner, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui.jsx'
import { useI18n } from '../../../shared/ui/I18nProvider.jsx'

const TOP_K = 10

function AgreementCard() {
  const { t } = useI18n()
  const { data, error, loading, reload } = useAsync((signal) => getAgreement({ signal }), [])
  const k = formatKappa(data?.kappa, data?.pairs)
  const detail = data?.pairs != null ? t('adm.kappa.pairs', { count: data.pairs }) : k.value === '—' ? t('adm.kappa.need') : ''
  return (
    <Card title={t('adm.an.agreement')} actions={<button type="button" className="adm-btn adm-btn-small adm-btn-ghost" onClick={reload}>{t('adm.refresh')}</button>}>
      {loading && !data ? <Skeleton lines={2} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : (
        <div className={`adm-kappa adm-kappa-${k.tone}`}>
          <span className="adm-kappa-value">{k.value}</span>
          <div>
            <strong>Cohen's κ · {t(`adm.kappa.${k.label}`)}</strong>
            <p className="adm-muted adm-small">{detail}</p>
          </div>
        </div>
      )}
    </Card>
  )
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function AnnotationPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') || ''
  const focusProduct = params.get('product') || ''
  const [draft, setDraft] = useState(query)
  const [state, dispatch] = useReducer(annotationReducer, undefined, () => initialAnnotationState())
  const [results, setResults] = useState([])
  const [load, setLoad] = useState({ loading: false, error: null })
  const [saveStatus, setSaveStatus] = useState({})
  const [saveError, setSaveError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const listRef = useRef(null)
  const { t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const stateRef = useRef(state)
  stateRef.current = state

  const recent = useAsync((signal) => listJudgments({ signal }), [])
  const recentQueries = [...new Set((recent.data?.items || []).map((j) => j.query))].slice(0, 8)

  useEffect(() => setDraft(query), [query])

  // Load the current top-k and this annotator's existing grades for the query.
  useEffect(() => {
    if (!query) {
      setResults([])
      dispatch({ type: 'reset', results: [] })
      return undefined
    }
    const controller = new AbortController()
    setLoad({ loading: true, error: null })
    setSaveStatus({})
    Promise.all([
      searchForAnnotation({ query, topK: TOP_K, signal: controller.signal }),
      listJudgments({ query, signal: controller.signal }).catch(() => ({ data: { items: [] } })),
    ]).then(([search, judgments]) => {
      if (controller.signal.aborted) return
      const items = search.data?.results || []
      setResults(items)
      dispatch({ type: 'reset', results: items, existing: gradesFromJudgments(judgments.data?.items) })
      if (focusProduct) dispatch({ type: 'focus', id: focusProduct })
      setLoad({ loading: false, error: null })
    }).catch((error) => {
      if (controller.signal.aborted || error?.name === 'AbortError') return
      setLoad({ loading: false, error })
    })
    return () => controller.abort()
  }, [query, focusProduct])

  const grade = useCallback(async (value, id) => {
    const current = stateRef.current
    const productId = id ?? current.ids[current.cursor]
    if (productId == null) return
    const previous = current.grades[productId] ?? null
    dispatch({ type: 'grade', grade: value, id: productId })
    setSaveStatus((s) => ({ ...s, [productId]: 'saving' }))
    setSaveError(null)
    try {
      await saveJudgment({ query, productId, grade: value })
      setSaveStatus((s) => ({ ...s, [productId]: 'saved' }))
    } catch (error) {
      dispatch({ type: 'revert', id: productId, previous })
      setSaveStatus((s) => ({ ...s, [productId]: 'error' }))
      setSaveError(tRef.current('adm.an.saveFailed', { id: productId, message: error.message }))
    }
  }, [query])

  useEffect(() => {
    function onKey(event) {
      const action = keyToAction(event)
      if (!action || stateRef.current.ids.length === 0) return
      event.preventDefault()
      if (action.type === 'grade') grade(action.grade)
      else dispatch(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [grade])

  // Keep the focused row visible.
  useEffect(() => {
    const row = listRef.current?.querySelector(`[data-index="${state.cursor}"]`)
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [state.cursor])

  async function onExport() {
    setExporting(true)
    setExportError(null)
    try {
      const { data } = await exportJudgments()
      download(data.blob, data.filename)
    } catch (error) {
      setExportError(error.message)
    } finally {
      setExporting(false)
    }
  }

  function submit(event) {
    event.preventDefault()
    const next = new URLSearchParams()
    if (draft.trim()) next.set('q', draft.trim())
    setParams(next)
  }

  const { graded, total } = progress(state)

  return (
    <>
      <PageHeader
        title={t('adm.an.title')}
        description={t('adm.an.intro')}
        actions={<button type="button" className="adm-btn" onClick={onExport} disabled={exporting}>{exporting ? t('adm.an.exporting') : t('adm.an.export')}</button>}
      />
      {exportError && <Banner tone="bad">{t('adm.an.exportFailed', { message: exportError })}</Banner>}
      <div className="adm-grid-annotate">
        <div>
          <Card>
            <form className="adm-toolbar" onSubmit={submit} role="search">
              <label className="adm-field adm-field-grow">
                <span className="adm-sr-only">{t('adm.an.query')}</span>
                <input type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('adm.an.placeholder')} list="adm-recent-queries" />
                <datalist id="adm-recent-queries">{recentQueries.map((q) => <option key={q} value={q} />)}</datalist>
              </label>
              <button type="submit" className="adm-btn adm-btn-primary" disabled={!draft.trim()}>{t('adm.an.load', { k: TOP_K })}</button>
            </form>
            {recentQueries.length > 0 && (
              <div className="adm-chips" role="group" aria-label={t('adm.an.recent')}>
                {recentQueries.map((q) => (
                  <button key={q} type="button" className={`adm-chip ${q === query ? 'active' : ''}`} onClick={() => setParams(new URLSearchParams({ q }))}>{q}</button>
                ))}
              </div>
            )}
          </Card>
          <Card
            title={query ? t('adm.an.resultsFor', { query }) : t('adm.an.results')}
            actions={total > 0 && <span className="adm-muted adm-small" aria-live="polite">{t('adm.an.graded', { graded, total })}</span>}
          >
            {saveError && <Banner tone="bad">{saveError}</Banner>}
            {!query ? <EmptyState title={t('adm.an.pick')} message={t('adm.an.pickText')} /> : load.loading ? <Skeleton lines={8} height={36} /> : load.error ? <ErrorState error={load.error} onRetry={() => setParams(new URLSearchParams(params))} /> : results.length === 0 ? <EmptyState title={t('adm.an.noResults')} message={t('adm.an.noResultsText')} /> : (
              <ol className="adm-annotate-list" ref={listRef} aria-label={t('adm.an.list')}>
                {results.map((r, index) => {
                  const g = state.grades[r.product_id]
                  const focused = index === state.cursor
                  const status = saveStatus[r.product_id]
                  return (
                    <li
                      key={r.product_id}
                      data-index={index}
                      className={`adm-annotate-item ${focused ? 'focused' : ''} ${g != null ? `graded-${g}` : ''}`}
                      aria-current={focused ? 'true' : undefined}
                      onClick={() => dispatch({ type: 'focus', id: r.product_id })}
                    >
                      <span className="adm-annotate-rank">{r.rank ?? index + 1}</span>
                      <div className="adm-annotate-body">
                        <strong>{r.title}</strong>
                        <span className="adm-muted adm-small">{[r.brand, r.category].filter(Boolean).join(' · ')} · <code>{r.product_id}</code></span>
                      </div>
                      <div className="adm-grade-group" role="group" aria-label={t('adm.an.gradeOf', { title: r.title })}>
                        {GRADES.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className={`adm-grade adm-grade-${value} ${g === value ? 'active' : ''}`}
                            aria-pressed={g === value}
                            title={t(`adm.grade.${value}`)}
                            aria-label={`${value} · ${t(`adm.grade.${value}`)}`}
                            onClick={(e) => { e.stopPropagation(); grade(value, r.product_id) }}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                      <span className={`adm-save-status ${status || ''}`} aria-live="polite">
                        {status === 'saving' ? t('adm.saving') : status === 'saved' ? t('adm.an.saved') : status === 'error' ? t('adm.an.failed') : ''}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>
        <div>
          <AgreementCard />
          <Card title={t('adm.an.shortcuts')}>
            <dl className="adm-dl adm-shortcuts">
              <dt><kbd>j</kbd> / <kbd>↓</kbd></dt><dd>{t('adm.an.nextResult')}</dd>
              <dt><kbd>k</kbd> / <kbd>↑</kbd></dt><dd>{t('adm.an.prevResult')}</dd>
              <dt><kbd>0</kbd></dt><dd>{t('adm.grade.0')}</dd>
              <dt><kbd>1</kbd></dt><dd>{t('adm.grade.1')}</dd>
              <dt><kbd>2</kbd></dt><dd>{t('adm.grade.2')}</dd>
            </dl>
            <p className="adm-muted adm-small">{t('adm.an.shortcutsHint')}</p>
          </Card>
        </div>
      </div>
    </>
  )
}
