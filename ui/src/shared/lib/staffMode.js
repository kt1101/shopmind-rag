// Staff mode: the storefront shows glass-box tools (inspectors, `explain`, pipeline names)
// only while a valid admin-console session exists (docs/API_CONTRACT.md "Storefront vs.
// staff"). Shoppers never see them. Pure helpers here; the React hook is useStaffMode.js.

import { SESSION_KEY, isSessionValid } from '../../pages/admin/lib/authStorage.js'

export const STAFF_OFF = Object.freeze({ active: false, user: null, expiresAt: null })

// Session (pages/admin/lib/authStorage.js shape) -> {active, user, expiresAt}.
export function staffModeFrom(session, now = Date.now()) {
  if (!isSessionValid(session, now)) return STAFF_OFF
  return {
    active: true,
    user: session.user && typeof session.user === 'object' ? { username: session.user.username ?? null, role: session.user.role ?? null } : null,
    expiresAt: Number.isFinite(session.expiresAt) ? session.expiresAt : null,
  }
}

// A `storage` event that may change staff mode: our key, or `null` (storage.clear()).
export function isStaffStorageEvent(event) {
  return Boolean(event) && (event.key === SESSION_KEY || event.key === null)
}

// Milliseconds until staff mode must be re-evaluated (session expiry), or null.
export function msUntilExpiry(state, now = Date.now()) {
  if (!state?.active || !Number.isFinite(state.expiresAt)) return null
  return Math.max(0, state.expiresAt - now)
}

export function sameStaffMode(a, b) {
  return a.active === b.active && a.expiresAt === b.expiresAt && (a.user?.username ?? null) === (b.user?.username ?? null) && (a.user?.role ?? null) === (b.user?.role ?? null)
}

// Request flag for glass-box data: shoppers never send `explain`.
export function explainFor(staff, wanted = true) {
  return Boolean(staff?.active && wanted)
}
