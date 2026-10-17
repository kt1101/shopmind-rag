import { useCallback, useEffect, useRef, useState } from 'react'
import { INSPECTOR_EVENT } from '../../shared/lib/inspectorBridge.js'
import InspectorDrawer from './InspectorDrawer.jsx'

// Global listener for `shopmind:open-inspector` (see shared/lib/inspectorBridge.js).
// Mount it once (e.g. in the admin layout) with a `loadTrace({traceId, signal})` that returns
// {data: Trace} — the admin uses shared/api/admin.js `getTrace`. It acknowledges every event
// with preventDefault so the caller does not show its raw-JSON fallback.
export default function InspectorHost({ loadTrace }) {
  const [traceId, setTraceId] = useState(null)
  const [state, setState] = useState({ trace: null, loading: false, error: null })
  const controllerRef = useRef(null)

  const load = useCallback((id) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ trace: null, loading: true, error: null })
    Promise.resolve(loadTrace({ traceId: id, signal: controller.signal }))
      .then((res) => {
        if (!controller.signal.aborted) setState({ trace: res?.data ?? null, loading: false, error: null })
      })
      .catch((error) => {
        if (!controller.signal.aborted && error?.name !== 'AbortError') setState({ trace: null, loading: false, error })
      })
  }, [loadTrace])

  useEffect(() => {
    function onOpen(event) {
      const id = event?.detail?.traceId
      if (!id) return
      event.preventDefault()
      setTraceId(id)
      load(id)
    }
    window.addEventListener(INSPECTOR_EVENT, onOpen)
    return () => {
      window.removeEventListener(INSPECTOR_EVENT, onOpen)
      controllerRef.current?.abort()
    }
  }, [load])

  return (
    <>
      <span data-shopmind-inspector="" hidden />
      <InspectorDrawer
        open={Boolean(traceId)}
        onClose={() => setTraceId(null)}
        trace={state.trace}
        loading={state.loading}
        error={state.error}
        onRetry={() => traceId && load(traceId)}
      />
    </>
  )
}
