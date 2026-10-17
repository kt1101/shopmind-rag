import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from './I18nProvider.jsx'
import './ui.css'

const ToastContext = createContext({ toast: () => {} })
const MAX_TOASTS = 3

export function ToastProvider({ children, durationMs = 3200 }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())
  const nextId = useRef(1)
  const { t } = useI18n()

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((item) => item.id !== id))
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
  }, [])

  const toast = useCallback((message, { tone = 'info' } = {}) => {
    const id = nextId.current
    nextId.current += 1
    setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, message, tone }])
    timers.current.set(id, setTimeout(() => dismiss(id), durationMs))
    return id
  }, [dismiss, durationMs])

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const timer of map.values()) clearTimeout(timer)
      map.clear()
    }
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="sm-toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`sm-toast sm-toast--${item.tone}`}>
            <span>{item.message}</span>
            <button type="button" className="sm-toast-close" aria-label={t('toast.close')} onClick={() => dismiss(item.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
