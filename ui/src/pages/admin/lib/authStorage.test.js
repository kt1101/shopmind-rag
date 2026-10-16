import test from 'node:test'
import assert from 'node:assert/strict'
import { SESSION_KEY, buildSession, clearSession, isSessionValid, loadSession, saveSession } from './authStorage.js'

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  }
}

const throwing = {
  getItem() { throw new Error('denied') },
  setItem() { throw new Error('denied') },
  removeItem() { throw new Error('denied') },
}

test('buildSession computes expiry from expires_in', () => {
  const s = buildSession({ access_token: 'abc', expires_in: 60, user: { username: 'a', role: 'admin' } }, 1000)
  assert.deepEqual(s, { token: 'abc', user: { username: 'a', role: 'admin' }, expiresAt: 61000 })
  assert.equal(buildSession({}), null)
  assert.equal(buildSession({ access_token: 't' }, 0).expiresAt, null)
})

test('isSessionValid checks token and expiry', () => {
  assert.equal(isSessionValid(null), false)
  assert.equal(isSessionValid({ token: '' }), false)
  assert.equal(isSessionValid({ token: 't', expiresAt: null }), true)
  assert.equal(isSessionValid({ token: 't', expiresAt: 10 }, 5), true)
  assert.equal(isSessionValid({ token: 't', expiresAt: 10 }, 10), false)
})

test('save/load/clear roundtrip', () => {
  const storage = memoryStorage()
  const session = { token: 't', user: null, expiresAt: 100 }
  assert.equal(saveSession(session, storage), true)
  assert.deepEqual(loadSession(storage, 50), session)
  clearSession(storage)
  assert.equal(loadSession(storage, 50), null)
})

test('loadSession drops expired and corrupt entries', () => {
  const storage = memoryStorage()
  saveSession({ token: 't', expiresAt: 100 }, storage)
  assert.equal(loadSession(storage, 200), null)
  assert.equal(storage.map.has(SESSION_KEY), false)
  storage.setItem(SESSION_KEY, '{not json')
  assert.equal(loadSession(storage), null)
  assert.equal(storage.map.has(SESSION_KEY), false)
})

test('storage failures never throw', () => {
  assert.equal(saveSession({ token: 't' }, throwing), false)
  assert.equal(loadSession(throwing), null)
  assert.doesNotThrow(() => clearSession(throwing))
  assert.equal(saveSession({ token: 't' }, null), false)
  assert.equal(loadSession(null), null)
})
