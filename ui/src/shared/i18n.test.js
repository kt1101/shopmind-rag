import assert from 'node:assert/strict'
import test from 'node:test'
import { ADMIN } from './i18n.admin.js'
import { MORE } from './i18n.more.js'
import { BASE, DICT, LANG_STORAGE_KEY, attributeLabel, categoryLabel, colorLabel, normalizeLang, readLang, translate, writeLang } from './i18n.js'
import { displayTitle } from '../entities/product/product.js'
import { memoryStorage, readJSON, writeJSON } from './lib/storage.js'

test('vi and en dictionaries define the same keys', () => {
  const vi = Object.keys(DICT.vi).sort()
  const en = Object.keys(DICT.en).sort()
  assert.deepEqual(en.filter((k) => !vi.includes(k)), [])
  assert.deepEqual(vi.filter((k) => !en.includes(k)), [])
})

test('dictionary parts never redefine each other\'s keys', () => {
  for (const lang of ['vi', 'en']) {
    const base = new Set(Object.keys(BASE[lang]))
    const more = Object.keys(MORE[lang])
    const admin = Object.keys(ADMIN[lang])
    assert.deepEqual(more.filter((k) => base.has(k)), [], `${lang}: MORE overrides BASE`)
    assert.deepEqual(admin.filter((k) => base.has(k) || more.includes(k)), [], `${lang}: ADMIN overrides`)
  }
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

test('real catalog vocabulary (ABO upper-case types) reads naturally in both languages', () => {
  assert.equal(categoryLabel('vi', 'SOFA'), 'Sofa')
  assert.equal(categoryLabel('vi', 'CELLULAR_PHONE_CASE'), 'Ốp điện thoại')
  assert.equal(categoryLabel('en', 'CELLULAR_PHONE_CASE'), 'Phone Case')
  assert.equal(categoryLabel('en', 'OUTDOOR_LIVING'), 'Outdoor Living')
  assert.equal(categoryLabel('vi', 'Home Furniture And Decor'), 'Nội thất & trang trí')
  assert.equal(categoryLabel('en', 'ABIS_HOME_IMPROVEMENT'), 'Home Improvement')
  assert.equal(colorLabel('vi', 'gray'), 'Xám')
  assert.equal(colorLabel('vi', 'navy blue'), 'Xanh navy')
  assert.equal(attributeLabel('vi', 'material'), 'Chất liệu')
  assert.equal(attributeLabel('vi', 'Product type'), 'Loại sản phẩm')
  assert.equal(attributeLabel('en', 'weight_g'), 'Weight g')
})

test('count of exactly one uses the .one variant when there is one', () => {
  assert.equal(translate('en', 'results.count', { count: 1 }), '1 product')
  assert.equal(translate('en', 'results.count', { count: 0 }), '0 products')
  assert.equal(translate('vi', 'results.count', { count: 1 }), '1 sản phẩm')
  assert.equal(translate('en', 'cart.addedMany', { count: 1 }), 'Added 1 items to the cart'.replace('1 items', '1 item'))
})

test('displayTitle decodes HTML entities left in catalog titles', () => {
  assert.equal(displayTitle('Dove Grey &amp; Black'), 'Dove Grey & Black')
  assert.equal(displayTitle('5&quot; &#8211; set &#x2F; 2'), '5" – set / 2')
  assert.equal(displayTitle('Fish & Chips'), 'Fish & Chips')
  assert.equal(displayTitle('&bogus;'), '&bogus;')
  assert.equal(displayTitle(null), '')
})
