import assert from 'node:assert/strict'
import test from 'node:test'
import { DICT, LANG_STORAGE_KEY, categoryLabel, colorLabel, normalizeLang, readLang, translate, writeLang } from './i18n.js'
import { memoryStorage, readJSON, writeJSON } from './lib/storage.js'

test('vi and en dictionaries define the same keys', () => {
  const vi = Object.keys(DICT.vi).sort()
  const en = Object.keys(DICT.en).sort()
  assert.deepEqual(en.filter((k) => !vi.includes(k)), [])
  assert.deepEqual(vi.filter((k) => !en.includes(k)), [])
})

test('translate fills placeholders and falls back to vi then the key', () => {
  assert.equal(translate('vi', 'results.for', { query: 'bốt' }), 'Kết quả cho “bốt”')
  assert.equal(translate('en', 'results.count', { count: 3 }), '3 products')
  assert.equal(translate('fr', 'nav.cart'), 'Giỏ hàng')
  assert.equal(translate('en', 'no.such.key'), 'no.such.key')
  assert.equal(translate('en', 'results.for', {}), 'Results for “{query}”')
})

test('language persists through storage and survives broken storage', () => {
  const storage = memoryStorage()
  assert.equal(readLang(storage), 'vi')
  writeLang('en', storage)
  assert.equal(readLang(storage), 'en')
  assert.equal(readLang(memoryStorage({ [LANG_STORAGE_KEY]: '"de"' })), 'vi')
  const broken = { getItem() { throw new Error('denied') }, setItem() { throw new Error('quota') } }
  assert.equal(readLang(broken), 'vi')
  assert.equal(writeLang('en', broken), false)
  assert.equal(normalizeLang(undefined), 'vi')
})

test('storage helpers never throw on bad JSON', () => {
  const storage = memoryStorage({ k: '{bad' })
  assert.equal(readJSON('k', 'fallback', storage), 'fallback')
  assert.equal(writeJSON('k', { a: 1 }, storage), true)
  assert.deepEqual(readJSON('k', null, storage), { a: 1 })
  assert.equal(readJSON('k', 1, null), 1)
})

test('category and colour labels are localized with a readable fallback', () => {
  assert.equal(categoryLabel('vi', 'backpacks'), 'Ba lô')
  assert.equal(categoryLabel('en', 'running_shoes'), 'Running Shoes')
  assert.equal(categoryLabel('vi', 'phone_cases'), 'Phone Cases')
  assert.equal(colorLabel('vi', 'black'), 'Đen')
  assert.equal(colorLabel('en', 'black'), 'Black')
  assert.equal(categoryLabel('vi', ''), '')
})
