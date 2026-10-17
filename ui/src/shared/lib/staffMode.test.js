import assert from 'node:assert/strict'
import test from 'node:test'
import { SESSION_KEY } from '../../pages/admin/lib/authStorage.js'
import { STAFF_OFF, explainFor, isStaffStorageEvent, msUntilExpiry, sameStaffMode, staffModeFrom } from './staffMode.js'

test('staff mode is on only for a valid admin session', () => {
  assert.deepEqual(staffModeFrom(null), STAFF_OFF)
  assert.deepEqual(staffModeFrom({ token: '' }), STAFF_OFF)
  assert.deepEqual(staffModeFrom({ token: 't', expiresAt: 100 }, 200), STAFF_OFF, 'expired')
  assert.deepEqual(staffModeFrom({ token: 't', user: { username: 'admin', role: 'admin', extra: 1 }, expiresAt: 500 }, 200),
    { active: true, user: { username: 'admin', role: 'admin' }, expiresAt: 500 })
  assert.deepEqual(staffModeFrom({ token: 't', expiresAt: null }), { active: true, user: null, expiresAt: null })
})

test('storage events: only the admin session key (or a full clear) matters', () => {
  assert.equal(isStaffStorageEvent({ key: SESSION_KEY }), true)
  assert.equal(isStaffStorageEvent({ key: null }), true)
  assert.equal(isStaffStorageEvent({ key: 'shopmind.cart' }), false)
  assert.equal(isStaffStorageEvent(null), false)
})

test('expiry timer and equality', () => {
  assert.equal(msUntilExpiry(STAFF_OFF), null)
  assert.equal(msUntilExpiry({ active: true, expiresAt: null }), null)
  assert.equal(msUntilExpiry({ active: true, expiresAt: 1500 }, 1000), 500)
  assert.equal(msUntilExpiry({ active: true, expiresAt: 900 }, 1000), 0)
  const a = staffModeFrom({ token: 't', user: { username: 'a', role: 'admin' }, expiresAt: 10 }, 0)
  assert.equal(sameStaffMode(a, { ...a, user: { ...a.user } }), true)
  assert.equal(sameStaffMode(a, STAFF_OFF), false)
})

test('shoppers never send explain', () => {
  assert.equal(explainFor(STAFF_OFF, true), false)
  assert.equal(explainFor({ active: true }, true), true)
  assert.equal(explainFor({ active: true }, false), false)
  assert.equal(explainFor(undefined), false)
})
