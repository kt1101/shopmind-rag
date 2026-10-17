import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ragCompare, resolveImageUrl } from '../../api.js'
import { productPath } from '../../lib/urlState.js'
import AnswerText from '../../entities/citation/AnswerText.jsx'
import { compareTable, pointAsAnswer, withoutId } from '../../features/compare/compareView.js'
import FeedbackWidget from '../../features/feedback/FeedbackWidget.jsx'
import { useShopLists } from '../../features/shop-lists/ShopListsProvider.jsx'
import { buildCompareUrl, parseCompareIds } from '../../features/shop-lists/shopLists.js'
import { categoryLabel } from '../../shared/i18n.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { Skeleton } from '../../shared/ui/Skeleton.jsx'
import RagInspector from '../../widgets/inspector/RagInspector.jsx'
import StatusBlock from '../../shop/StatusBlock.jsx'
import '../../features/compare/compare.css'
import '../../entities/citation/citation.css'
import './compare-page.css'

export default function ComparePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { compare, removeFromCompare } = useShopLists()
  const ids = useMemo(() => parseCompareIds(params.get('ids')), [params])
  const idsKey = ids.join(',')

  const [question, setQuestion] = useState('')
  const [asked, setAsked] = useState('')
  const [state, setState] = useState({ data: null, loading: false, error: null })
  const [reload, setReload] = useState(0)
  const [showTrace, setShowTrace] = useState(false)

  useEffect(() => {
    if (ids.length < 2) {
      setState({ data: null, loading: false, error: null })
      return undefined
    }
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    ragCompare({ productIds: ids, question: asked, explain: true, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setState({ data: res?.data || null, loading: false, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted && error.name !== 'AbortError') setState({ data: null, loading: false, error })
      })
    return () => controller.abort()
  }, [idsKey, asked, reload]) // ids is derived from idsKey

  const table = useMemo(() => compareTable(state.data, t('compare.noData')), [state.data, t])

  function remove(id) {
    removeFromCompare(id)
    navigate(buildCompareUrl(withoutId(ids, id)), { replace: true })
  }

  if (ids.length < 2) {
    const trayIds = compare.map((item) => item.product_id)
    return (
      <div className="compare-page">
        <h1>{t('compare.title')}</h1>
        <StatusBlock
          tone="empty"
          title={t('compare.needTwo')}
          message={t('compare.trayCount', { count: trayIds.length })}
          action={trayIds.length >= 2 ? { label: t('compare.go'), onClick: () => navigate(buildCompareUrl(trayIds)) } : { label: t('nav.catalog'), onClick: () => navigate('/') }}
        />
      </div>
    )
  }

  const { data, loading, error } = state

  return (
    <div className="compare-page">
      <h1>{t('compare.title')}</h1>

      {error ? (
        <StatusBlock tone="error" title={t('compare.failed')} message={error.message} action={{ label: t('state.retry'), onClick: () => setReload((n) => n + 1) }} />
      ) : !data && loading ? (
        <div role="status" aria-live="polite">
          <p className="sm-muted">{t('compare.loading')}</p>
          <Skeleton lines={8} />
        </div>
      ) : data ? (
        <div className={loading ? 'compare-body is-refreshing' : 'compare-body'} aria-busy={loading}>
          <section aria-labelledby="compare-attrs">
            <h2 id="compare-attrs" className="compare-h2">{t('compare.attributes')}</h2>
            <p className="sm-muted sm-small">{t('compare.attributesHint')}</p>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">{t('product.attribute')}</span></th>
                    {table.products.map((p) => {
                      const img = resolveImageUrl(p.image_url)
                      return (
                        <th key={p.product_id} scope="col" className="compare-product">
                          <span className="compare-product-thumb">{img ? <img src={img} alt="" /> : <span aria-hidden="true">◇</span>}</span>
                          <Link to={productPath(p.product_id)}>{p.title}</Link>
                          <span className="sm-muted sm-small">{p.brand} · {categoryLabel(lang, p.category)}</span>
                          <button type="button" className="sm-button sm-button--ghost sm-button--small" onClick={() => remove(p.product_id)} aria-label={t('compare.remove', { title: p.title })}>×</button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row.name} className={row.differs ? 'is-different' : ''}>
                      <th scope="row">{row.name}</th>
                      {row.cells.map((cell) => (
                        <td key={cell.productId} className={cell.missing ? 'is-missing' : ''}>{cell.value}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="compare-summary" className="compare-summary">
            <h2 id="compare-summary" className="compare-h2">{t('compare.summary')}</h2>
            {data.insufficient_evidence ? (
              <div className="compare-insufficient" role="note">
                <strong>{t(data.llm_available === false ? 'compare.noLlm' : 'compare.insufficient')}</strong>
                {data.summary && <p>{data.summary}</p>}
              </div>
            ) : (
              <>
                {data.summary && <p>{data.summary}</p>}
                <ul className="compare-points">
                  {(data.points || []).map((point, i) => (
                    <li key={i}><AnswerText answer={pointAsAnswer(point)} sources={data.sources || []} showUnreferenced={false} /></li>
                  ))}
                </ul>
              </>
            )}

            <form className="compare-question" onSubmit={(e) => { e.preventDefault(); setAsked(question.trim()) }}>
              <label htmlFor="compare-q">{t('compare.question')}</label>
              <div className="compare-question-row">
                <input id="compare-q" type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('compare.questionPlaceholder')} maxLength={300} />
                <button type="submit" className="sm-button sm-button--primary" disabled={loading}>{t('compare.ask')}</button>
              </div>
            </form>

            <div className="answer-tools">
              {data.trace && (
                <button type="button" className="sm-button sm-button--small" aria-expanded={showTrace} onClick={() => setShowTrace((v) => !v)}>
                  <span aria-hidden="true">🔍</span> {showTrace ? t('answer.hideTrace') : t('answer.showTrace')}
                </button>
              )}
              <FeedbackWidget target="answer" traceId={data.trace_id} query={asked || `compare:${idsKey}`} compact />
            </div>
            {showTrace && data.trace && <RagInspector trace={data.trace} />}
          </section>
        </div>
      ) : null}
    </div>
  )
}
