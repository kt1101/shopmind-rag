// Admin session storage: the token lives in memory (shared/api/http.js) and is mirrored to
// localStorage so a reload keeps the session and other tabs see logins/logouts (the storefront's
// staff mode listens to the `storage` event, see shared/lib/useStaffMode.js). Expired sessions
// are dropped on load. Every storage access is wrapped in try/catch: private windows, blocked
// site data and previews can throw.

export const SESSION_KEY = 'shopmind.admin.session'
// Same-tab notification (the `storage` event only reaches *other* tabs).
export const SESSION_EVENT = 'shopmind:admin-session'

function defaultStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function notify() {
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_EVENT))
  } catch {
    // ignore
  }
}

export function buildSession(loginResponse, now = Date.now()) {
  if (!loginResponse?.access_token) return null
  const expiresIn = Number(loginResponse.expires_in)
  return {
    token: loginResponse.access_token,
    user: loginResponse.user || null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
  }
}

export function isSessionValid(session, now = Date.now()) {
  if (!session || typeof session.token !== 'string' || !session.token) return false
  return session.expiresAt == null || session.expiresAt > now
}

export function saveSession(session, storage = defaultStorage()) {
  if (!storage) return false
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session))
    notify()
    return true
  } catch {
    return false
  }
}

export function clearSession(storage = defaultStorage()) {
  if (!storage) return
  try {
    storage.removeItem(SESSION_KEY)
  } catch {
    // ignore: nothing else we can do
  }
  notify()
}

export function loadSession(storage = defaultStorage(), now = Date.now()) {
  if (!storage) return null
  let raw
  try {
    raw = storage.getItem(SESSION_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    clearSession(storage)
    return null
  }
  if (!isSessionValid(parsed, now)) {
    clearSession(storage)
    return null
  }
  return parsed
}
