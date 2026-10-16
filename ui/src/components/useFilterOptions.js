import { useCallback, useEffect, useState } from 'react'
import { getFilterOptions } from '../api.js'

export function useFilterOptions(field, prefix = '', enabled = true, limit = 20) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reloadIndex, setReloadIndex] = useState(0)

  const reload = useCallback(() => {
    setReloadIndex((prev) => prev + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !field) {
      setLoading(false)
      return undefined
    }

    const abortController = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      getFilterOptions({ field, prefix, limit, signal: abortController.signal })
        .then((response) => {
          if (!abortController.signal.aborted) {
            setOptions(response?.data?.options ?? [])
          }
        })
        .catch((err) => {
          if (err.name !== 'AbortError') {
            setError(err.message)
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setLoading(false)
          }
        })
    }, prefix ? 250 : 0)

    return () => {
      clearTimeout(timer)
      abortController.abort()
    }
  }, [field, prefix, enabled, limit, reloadIndex])

  return { options, loading, error, reload }
}

export default useFilterOptions
