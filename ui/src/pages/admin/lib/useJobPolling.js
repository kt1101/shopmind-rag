import { useCallback, useEffect, useReducer, useRef } from 'react'
import { initialPollState, nextPollDelay, pollReducer } from './jobPolling.js'

// Drives pollReducer: fetches once, then re-fetches every 3s while any job is active.
// `fetchJobs(signal)` must resolve to an array of jobs.
export function useJobPolling(fetchJobs) {
  const [state, dispatch] = useReducer(pollReducer, initialPollState)
  const fetchRef = useRef(fetchJobs)
  fetchRef.current = fetchJobs
  const controllerRef = useRef(null)

  const run = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'fetch' })
    try {
      const jobs = await fetchRef.current(controller.signal)
      if (!controller.signal.aborted) dispatch({ type: 'success', jobs, at: Date.now() })
    } catch (error) {
      if (!controller.signal.aborted && error?.name !== 'AbortError') dispatch({ type: 'failure', error })
    }
  }, [])

  useEffect(() => {
    run()
    return () => controllerRef.current?.abort()
  }, [run])

  const delay = nextPollDelay(state)
  useEffect(() => {
    if (delay == null) return undefined
    const timer = setTimeout(run, delay)
    return () => clearTimeout(timer)
  }, [delay, state.lastUpdated, state.failures, run])

  const jobUpdated = useCallback((job) => dispatch({ type: 'jobUpdated', job }), [])
  return { ...state, refresh: run, jobUpdated }
}
