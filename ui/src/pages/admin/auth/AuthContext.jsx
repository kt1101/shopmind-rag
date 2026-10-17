import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { setAuthToken } from '../../../shared/api/http.js'
import { login as apiLogin, onUnauthorized } from '../../../shared/api/admin.js'
import { buildSession, clearSession, isSessionValid, loadSession, saveSession } from '../lib/authStorage.js'

const AuthContext = createContext(null)

function initialSession() {
  const session = loadSession()
  setAuthToken(session?.token ?? null)
  return session
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(initialSession)
  const [notice, setNotice] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()

  const logout = useCallback((reason) => {
    setAuthToken(null)
    clearSession()
    setSession(null)
    setNotice(reason || null)
  }, [])

  const login = useCallback(async ({ username, password, signal }) => {
    const { data } = await apiLogin({ username, password, signal })
    const next = buildSession(data)
    if (!next) throw new Error('Login response did not include a token')
    setAuthToken(next.token)
    saveSession(next)
    setSession(next)
    setNotice(null)
    return next
  }, [])

  // Any admin call answering 401 logs out and sends the user to the login page.
  useEffect(() => onUnauthorized(() => {
    logout('adm.session.expired')
    const here = location.pathname + location.search
    navigate(`/admin/login?next=${encodeURIComponent(here)}`, { replace: true })
  }), [logout, navigate, location.pathname, location.search])

  // Expire the session client-side when the token's lifetime runs out.
  useEffect(() => {
    if (!session?.expiresAt) return undefined
    const ms = session.expiresAt - Date.now()
    if (ms <= 0) {
      logout('adm.session.expired')
      return undefined
    }
    const timer = setTimeout(() => logout('adm.session.expired'), Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [session, logout])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    isAuthenticated: isSessionValid(session),
    login,
    logout,
    notice,
  }), [session, login, logout, notice])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

export function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  if (!isAuthenticated) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/admin/login?next=${next}`} replace />
  }
  return children
}
