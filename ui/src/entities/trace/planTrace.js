// Shopping-planner trace view models (docs/API_CONTRACT.md "Shopping planner"): steps
// `decompose`, one `retrieve` per need (step id = need id), `optimize_budget`,
// `build_context`, then `generate` + `validate_citations` (LLM) or `justify` (rules).

import { findStep, findSteps, itemsOf } from './traceModel.js'

export const PLAN_STEPS = new Set(['decompose', 'optimize_budget', 'justify'])

export function isPlanTrace(trace) {
  if (!trace) return false
  if (trace.kind === 'plan' || /(^|\.)plan$/.test(String(trace.pipeline || ''))) return true
  return Array.isArray(trace.steps) && trace.steps.some((s) => s && PLAN_STEPS.has(s.step))
}

export function decomposeView(trace) {
  const step = findStep(trace, 'decompose')
  if (!step) return null
  const d = step.details || {}
  return {
    impl: step.impl ?? null,
    occasion: d.occasion?.label || d.occasion?.id || (typeof d.occasion === 'string' ? d.occasion : null),
    budget: Number.isFinite(d.budget) ? d.budget : null,
    budgetSource: d.budget_source ?? null,
    language: d.language ?? null,
    needs: (Array.isArray(d.needs) ? d.needs : []).map((n, i) => ({
      id: String(n.id ?? `n${i + 1}`),
      label: n.label ?? n.query ?? String(n.id ?? ''),
      query: n.query ?? '',
      categories: Array.isArray(n.categories) ? n.categories : [],
      priority: n.priority ?? null,
    })),
  }
}

// One entry per `retrieve` step: {needId, label, impl, durationMs, items:[{id,title,rank,score,price}]}
export function retrievalsByNeed(trace) {
  const labels = new Map((decomposeView(trace)?.needs || []).map((n) => [n.id, n.label]))
  return findSteps(trace, 'retrieve').map((step, index) => {
    const needId = String(step.id ?? `retrieve-${index}`)
    return {
      needId,
      label: labels.get(needId) ?? step.params?.query ?? needId,
      impl: step.impl ?? null,
      summary: step.summary ?? '',
      durationMs: Number.isFinite(Number(step.duration_ms)) ? Number(step.duration_ms) : null,
      items: itemsOf(step).map((item) => ({
        id: String(item.id),
        title: item.title ?? String(item.id),
        rank: item.rank ?? null,
        score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
        price: Number.isFinite(item.details?.price) ? item.details.price : null,
      })),
    }
  })
}

export function budgetView(trace) {
  const step = findStep(trace, 'optimize_budget')
  if (!step) return null
  const d = step.details || {}
  return {
    impl: step.impl ?? null,
    budget: Number.isFinite(d.budget) ? d.budget : null,
    total: Number.isFinite(d.total) ? d.total : null,
    withinBudget: typeof d.within_budget === 'boolean' ? d.within_budget : null,
    decisions: (Array.isArray(d.decisions) ? d.decisions : []).map((x) => ({
      needId: String(x.need_id ?? ''),
      status: x.status ?? null,
      productId: x.product_id ?? null,
      price: Number.isFinite(x.price) ? x.price : null,
      reason: x.reason ?? null,
    })),
  }
}

// "llm" when the trace has a generate step, "rules" when it has justify, else null.
export function planMethod(trace) {
  if (findStep(trace, 'generate')) return 'llm'
  if (findStep(trace, 'justify')) return 'rules'
  return findStep(trace, 'decompose')?.impl ?? null
}
