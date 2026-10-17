import { useEffect, useState } from 'react'
import { SESSION_EVENT, loadSession } from '../../pages/admin/lib/authStorage.js'
import { isStaffStorageEvent, msUntilExpiry, sameStaffMode, staffModeFrom } from './staffMode.js'

function read() {
  return staffModeFrom(loadSession())
}

// {active, user, expiresAt}: true while an admin-console session exists. Follows logins and
// logouts in other tabs (`storage` event), in this tab (SESSION_EVENT) and the token expiry.
export function useStaffMode() {
  const [state, setState] = useState(read)

  useEffect(() => {
    const refresh = () => setState((current) => {
      const next = read()
      return sameStaffMode(current, next) ? current : next
    })
    const onStorage = (event) => {
      if (isStaffStorageEvent(event)) refresh()
    }
    refresh()
    window.addEventListener('storage', onStorage)
    window.addEventListener(SESSION_EVENT, refresh)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(SESSION_EVENT, refresh)
    }
  }, [])

  useEffect(() => {
    const ms = msUntilExpiry(state)
    if (ms == null) return undefined
    const timer = setTimeout(() => setState(read()), Math.min(ms + 50, 2 ** 31 - 1))
    return () => clearTimeout(timer)
  }, [state])

  return state
}
