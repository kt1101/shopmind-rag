import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ragPlan, resolveImageUrl } from '../../api.js'
import { formatPrice } from '../../lib/format.js'
import { buildSearchUrl, productPath } from '../../lib/urlState.js'
import AnswerText from '../../entities/citation/AnswerText.jsx'
import { displayTitle } from '../../entities/product/product.js'
import {
  PLAN_MAX_CHARS, buildPlanUrl, canPlan, chosenProducts, citationsFor, isEdited, normalizePlan, parseBudget, parsePlanParams, removeChoice, swapChoice,
} from '../../features/planner/plan.js'
import { useShopLists } from '../../features/shop-lists/ShopListsProvider.jsx'
import { categoryLabel } from '../../shared/i18n.js'
import { useStaffMode } from '../../shared/lib/useStaffMode.js'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import { SkeletonBlock } from '../../shared/ui/Skeleton.jsx'
import StatusBlock, { ErrorBlock } from '../../shop/StatusBlock.jsx'
import InspectorDrawer from '../../widgets/inspector/InspectorDrawer.jsx'
import '../../entities/citation/citation.css'
import './plan.css'

const EXAMPLES = {
  vi: [
    'Mình mới chuyển vào căn hộ studio, ngân sách 800 đô',
    'Chuẩn bị đi biển 5 ngày cho 2 người, dưới 300 đô',
    'Góc làm việc tại nhà gọn gàng, ngân sách 500 đô',
    'Quà sinh nhật cho bạn gái khoảng 150 đô',
    'Đồ dùng cho chó con mới về nhà',
    'Leo núi cuối tuần, ngân sách 400 đô',
  ],
  en: [
    'I just moved into a studio apartment, budget $800',
    'Beach trip for 2 people, 5 days, under $300',
    'A tidy home office corner, budget $500',
    'Birthday gift for my girlfriend, around $150',
    'Things for a new puppy',
    'Weekend hiking trip, budget $400',
  ],
}

function money(amount, currency = 'USD') {
  return formatPrice({ amount, currency }) ?? `${amount} ${currency}`
}

function Thumb({ item, className = 'plan-thumb' }) {
  const [broken, setBroken] = useState(false)
  const src = resolveImageUrl(item?.image_url)
  return (
    <span className={className}>
      {src && !broken ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span aria-hidden="true">◇</span>}
    </span>
  )
}

function StockLine({ inStock }) {
  const { t } = useI18n()
  if (inStock === null || inStock === undefined) return null
  return <span className={`plan-stock ${inStock ? 'is-in' : 'is-out'}`}>{inStock ? t('plan.inStock') : t('product.outOfStock')}</span>
}

function BudgetBar({ plan }) {
  const { t } = useI18n()
  const info = plan.budgetInfo
  if (!info.hasBudget) {
    return (
      <div className="plan-budget">
        <p className="plan-budget-line"><strong>{t('plan.total')}: {money(plan.total, plan.currency)}</strong> <span className="sm-muted">· {t('plan.noBudget')}</span></p>
      </div>
    )
  }
  return (
    <div className={`plan-budget ${info.within ? 'is-within' : 'is-over'}`}>
      <p className="plan-budget-line">
        <strong>{t('plan.total')}: {money(plan.total, plan.currency)}</strong>
        <span> / {t('plan.budget')} {money(plan.budget, plan.currency)}</span>
        <span className={`sm-badge ${info.within ? 'sm-badge--success' : 'sm-badge--danger'}`}>
          {info.within ? t('plan.remaining', { amount: money(info.remaining, plan.currency) }) : t('plan.over', { amount: money(info.over, plan.currency) })}
        </span>
      </p>
      <div className="plan-meter" role="meter" aria-valuemin={0} aria-valuemax={plan.budget} aria-valuenow={plan.total} aria-label={t('plan.meter', { total: money(plan.total, plan.currency), budget: money(plan.budget, plan.currency) })}>
        <span style={{ width: `${Math.min(100, info.pct)}%` }} />
      </div>
    </div>
  )
}

function Alternatives({ need, onPick, label }) {
  const { t } = useI18n()
  if (!need.alternatives.length) return null
  return (
    <div className="plan-alts">
      <p className="plan-alts-title sm-small sm-muted">{label}</p>
      <ul>
        {need.alternatives.map((item) => (
          <li key={item.product_id}>
            <button type="button" className="plan-alt" onClick={() => onPick(need.id, item.product_id)} aria-label={t('plan.pick', { title: displayTitle(item.title), price: item.price ? money(item.price.amount, item.price.currency) : '—' })} title={displayTitle(item.title)}>
              <Thumb item={item} className="plan-alt-thumb" />
              <span className="plan-alt-title">{displayTitle(item.title)}</span>
              <span className="plan-alt-price">{item.price ? money(item.price.amount, item.price.currency) : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NeedCard({ need, sources, onPick, onRemove }) {
  const { t, lang } = useI18n()
  const lists = useShopLists()
  const item = need.chosen
  const swapped = Boolean(item && need.serverChoice && item.product_id !== need.serverChoice)
  const citations = citationsFor(sources, need.citationIds)
  return (
    <article className={`plan-need is-${need.status}`} aria-labelledby={`need-${need.id}`}>
      <header className="plan-need-head">
        <h3 id={`need-${need.id}`}>{need.label}</h3>
        <span className={`sm-badge ${need.priority === 'must' ? 'sm-badge--accent' : ''}`}>{t(`plan.priority.${need.priority}`)}</span>
        {need.status !== 'chosen' && <span className={`sm-badge ${need.status === 'skipped_budget' ? 'sm-badge--warning' : ''}`}>{t(`plan.status.${need.status}`)}</span>}
      </header>

      {item ? (
        <div className="plan-item">
          <Link to={productPath(item.product_id)} className="plan-item-link" tabIndex={-1} aria-hidden="true">
            <Thumb item={item} />
          </Link>
          <div className="plan-item-info">
            <Link to={productPath(item.product_id)} className="plan-item-title">{displayTitle(item.title)}</Link>
            <span className="sm-muted sm-small">{[item.brand, categoryLabel(lang, item.category)].filter(Boolean).join(' · ')}</span>
            <span className="plan-item-price">
              {item.price ? money(item.price.amount, item.price.currency) : t('plan.noPrice')}
              {item.price?.synthetic && <small className="sm-muted"> {t('plan.synthetic')}</small>}
            </span>
            <StockLine inStock={item.in_stock} />
          </div>
          <div className="plan-item-actions">
            <button type="button" className="sm-button sm-button--small sm-button--primary" onClick={() => lists.addToCart(item)}>{t('product.addToCart')}</button>
            <button type="button" className="sm-button sm-button--small" aria-pressed={lists.isComparing(item.product_id)} onClick={() => lists.toggleCompare(item)}>
              {lists.isComparing(item.product_id) ? '✓ ' : '+ '}{t('card.compare')}
            </button>
            <button type="button" className="sm-button sm-button--small sm-button--ghost" onClick={() => onRemove(need.id)}>{t('plan.remove')}</button>
          </div>
        </div>
      ) : need.status === 'no_match' ? (
        <p className="plan-need-note">
          {t('plan.noMatchHint')}{' '}
          {need.query && <Link to={buildSearchUrl({ type: 'text', query: need.label })}>{t('plan.searchInstead', { query: need.label })}</Link>}
        </p>
      ) : (
        <p className="plan-need-note">{need.reason || t('plan.skippedHint')}</p>
      )}

      {swapped ? (
        <p className="plan-need-note sm-small">
          {t('plan.swapped')}{' '}
          <button type="button" className="plan-link-button" onClick={() => onPick(need.id, need.serverChoice)}>{t('plan.restore')}</button>
        </p>
      ) : need.reason && need.status === 'chosen' ? (
        <div className="plan-reason">
          <AnswerText answer={need.reason} sources={citations} />
        </div>
      ) : null}

      <Alternatives need={need} onPick={onPick} label={item ? t('plan.alternatives') : t('plan.pickAlternative')} />
    </article>
  )
}

function ResultSkeleton() {
  const { t } = useI18n()
  return (
    <div className="plan-result" role="status" aria-live="polite" aria-label={t('plan.loading')}>
      <p className="sm-muted">{t('plan.loading')}</p>
      <SkeletonBlock height={70} />
      <div className="plan-needs">
        {[0, 1, 2].map((i) => <SkeletonBlock key={i} height={190} />)}
      </div>
    </div>
  )
}

// F6 shopping planner: describe the occasion (+ optional budget), get one product per need
// with cited reasons, swap alternatives (total recomputed client-side), add all to the cart.
export default function PlanPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const staff = useStaffMode()
  const lists = useShopLists()
  const { query, budget } = useMemo(() => parsePlanParams(params), [params])

  const [draft, setDraft] = useState(query)
  const [budgetDraft, setBudgetDraft] = useState(budget != null ? String(budget) : '')
  const [state, setState] = useState({ plan: null, loading: false, error: null })
  const [reload, setReload] = useState(0)
  const [showTrace, setShowTrace] = useState(false)
  const resultRef = useRef(null)
  const submitted = useRef(false)

  useEffect(() => {
    setDraft(query)
    setBudgetDraft(budget != null ? String(budget) : '')
  }, [query, budget])

  useEffect(() => {
    if (!canPlan(query)) {
      setState({ plan: null, loading: false, error: null })
      return undefined
    }
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))
    ragPlan({ request: query, budget, language: lang, explain: staff.active, signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setState({ plan: normalizePlan(res?.data), loading: false, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== 'AbortError') setState({ plan: null, loading: false, error })
      })
    return () => controller.abort()
    // the language is sent as a hint; switching it should not re-plan
  }, [query, budget, reload, staff.active]) // eslint-disable-line react-hooks/exhaustive-deps

  // After the shopper asks for a plan (not on a shared link), bring the result into view when
  // it starts below the fold (on phones the form and examples fill the first screen).
  useEffect(() => {
    if (!submitted.current || state.loading || (!state.plan && !state.error)) return
    submitted.current = false
    const el = resultRef.current
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.6) el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [state])

  function submit(event) {
    event.preventDefault()
    if (!canPlan(draft)) return
    submitted.current = true
    navigate(buildPlanUrl({ query: draft, budget: budgetDraft }))
  }

  function runExample(text) {
    submitted.current = true
    navigate(buildPlanUrl({ query: text }))
  }

  const plan = state.plan
  const pick = (needId, productId) => setState((s) => ({ ...s, plan: swapChoice(s.plan, needId, productId) }))
  const remove = (needId) => setState((s) => ({ ...s, plan: removeChoice(s.plan, needId) }))
  const chosen = chosenProducts(plan)
  const examples = EXAMPLES[lang] || EXAMPLES.vi
  const tooLong = draft.length > PLAN_MAX_CHARS

  return (
    <div className="plan-page">
      <section className="plan-hero" aria-labelledby="plan-title">
        <p className="plan-kicker">{t('plan.kicker')}</p>
        <h1 id="plan-title">{t('plan.title')}</h1>
        <p className="plan-intro">{t('plan.intro')}</p>
        <form className="plan-form" onSubmit={submit}>
          <label htmlFor="plan-request" className="plan-label">{t('plan.label')}</label>
          <textarea
            id="plan-request"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e) }}
            placeholder={t('plan.placeholder')}
            rows={3}
            maxLength={PLAN_MAX_CHARS + 50}
            aria-invalid={tooLong}
          />
          <div className="plan-form-row">
            <label className="plan-budget-field" htmlFor="plan-budget">
              <span>{t('plan.budgetLabel')}</span>
              <span className="plan-budget-input">
                <span aria-hidden="true">$</span>
                <input id="plan-budget" type="number" inputMode="decimal" min="1" step="1" value={budgetDraft} onChange={(e) => setBudgetDraft(e.target.value)} placeholder={t('plan.budgetPlaceholder')} />
              </span>
            </label>
            <span className={`plan-count sm-small ${tooLong ? 'is-over' : 'sm-muted'}`}>{draft.length}/{PLAN_MAX_CHARS}</span>
            <button type="submit" className="sm-button sm-button--primary plan-submit" disabled={!canPlan(draft) || state.loading || (budgetDraft !== '' && parseBudget(budgetDraft) == null)}>
              {state.loading ? t('plan.loadingShort') : t('plan.submit')}
            </button>
          </div>
        </form>
        <div className="plan-examples" role="group" aria-label={t('plan.examples')}>
          <span className="sm-small sm-muted">{t('plan.examples')}:</span>
          {examples.map((text) => (
            <button key={text} type="button" className="plan-example" disabled={state.loading} onClick={() => runExample(text)}>{text}</button>
          ))}
        </div>
      </section>

      <div ref={resultRef} className="plan-result-anchor" />
      {state.loading && !plan ? <ResultSkeleton /> : state.error ? (
        <ErrorBlock error={state.error} context={t('plan.failed')} onRetry={() => setReload((n) => n + 1)} />
      ) : plan ? (
        <section className={`plan-result ${state.loading ? 'is-refreshing' : ''}`} aria-labelledby="plan-result-title" aria-busy={state.loading}>
          <header className="plan-result-head">
            <div>
              {plan.occasion?.label && <span className="sm-badge sm-badge--accent">{plan.occasion.label}</span>}
              <h2 id="plan-result-title">{t('plan.resultTitle')}</h2>
            </div>
            {staff.active && (
              <div className="plan-staff">
                {plan.method && <code className="plan-method" title={t('staff.pipelineHint')}>method: {plan.method}</code>}
                {plan.trace && <button type="button" className="sm-button sm-button--small" onClick={() => setShowTrace(true)}><span aria-hidden="true">🔍</span> {t('answer.showTrace')}</button>}
              </div>
            )}
          </header>
          {plan.summary && <p className="plan-summary">{plan.summary}{isEdited(plan) && <span className="plan-summary-stale"> {t('plan.summaryStale')}</span>}</p>}
          <BudgetBar plan={plan} />
          {plan.insufficientEvidence && <p className="plan-warning" role="note">{t('plan.insufficient')}</p>}

          {plan.needs.length === 0 ? (
            <StatusBlock tone="empty" title={t('plan.empty')} message={t('plan.emptyHint')} />
          ) : (
            <div className="plan-needs">
              {plan.needs.map((need) => <NeedCard key={need.id} need={need} sources={plan.sources} onPick={pick} onRemove={remove} />)}
            </div>
          )}

          <div className="plan-actions">
            <button type="button" className="sm-button sm-button--primary" disabled={!chosen.length} onClick={() => lists.addManyToCart(chosen)}>
              {t('plan.addAll', { count: chosen.length })}
            </button>
            <Link to="/cart" className="sm-button">{t('nav.cart')} ({lists.cartCount})</Link>
            <span className="sm-small sm-muted">{t('plan.syntheticNote')}</span>
          </div>

          {plan.tips.length > 0 && (
            <section className="plan-tips" aria-labelledby="plan-tips-title">
              <h3 id="plan-tips-title">{t('plan.tips')}</h3>
              <ul>
                {plan.tips.map((tip, i) => (
                  <li key={i}><AnswerText answer={tip.text} sources={citationsFor(plan.sources, tip.citationIds)} /></li>
                ))}
              </ul>
            </section>
          )}
        </section>
      ) : null}

      {staff.active && <InspectorDrawer open={showTrace && Boolean(plan?.trace)} onClose={() => setShowTrace(false)} trace={plan?.trace} view="plan" />}
    </div>
  )
}
