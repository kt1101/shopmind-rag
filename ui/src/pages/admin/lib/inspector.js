// Bridge to the global Inspector widget (widgets/inspector/InspectorDrawer), which listens for
// `shopmind:open-inspector`. The Inspector acknowledges by calling event.preventDefault()
// (the event is cancelable) or by being present in the DOM with a data-shopmind-inspector
// attribute. Without an acknowledgement the admin page shows its raw-JSON fallback modal.

export const INSPECTOR_EVENT = 'shopmind:open-inspector'
const INSPECTOR_SELECTOR = '[data-shopmind-inspector], [data-inspector-drawer]'

export function isInspectorMounted(doc = typeof document === 'undefined' ? null : document) {
  try {
    return !!doc?.querySelector?.(INSPECTOR_SELECTOR)
  } catch {
    return false
  }
}

export function openInspector(traceId, target = typeof window === 'undefined' ? null : window) {
  if (!target || typeof CustomEvent === 'undefined') return { acknowledged: false }
  const event = new CustomEvent(INSPECTOR_EVENT, { detail: { traceId }, cancelable: true })
  const notCancelled = target.dispatchEvent(event)
  return { acknowledged: !notCancelled || isInspectorMounted(target.document) }
}
