import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LANG, readLang, translate, writeLang } from '../i18n.js'

const fallback = {
  lang: DEFAULT_LANG,
  setLang: () => {},
  t: (key, vars) => translate(DEFAULT_LANG, key, vars),
}

const I18nContext = createContext(fallback)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => readLang())

  useEffect(() => {
    try {
      document.documentElement.lang = lang
    } catch {
      // no document (tests)
    }
  }, [lang])

  const setLang = useCallback((next) => {
    setLangState(next)
    writeLang(next)
  }, [])

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
