import test from 'node:test'
import assert from 'node:assert/strict'
import { annotationReducer, gradesFromJudgments, initialAnnotationState, keyToAction, progress } from './annotation.js'

const results = [{ product_id: 'A' }, { product_id: 'B' }, { product_id: 'C' }]

test('keyToAction maps shortcuts', () => {
  assert.deepEqual(keyToAction({ key: 'j' }), { type: 'move', delta: 1 })
  assert.deepEqual(keyToAction({ key: 'ArrowUp' }), { type: 'move', delta: -1 })
  assert.deepEqual(keyToAction({ key: '2' }), { type: 'grade', grade: 2 })
  assert.equal(keyToAction({ key: '3' }), null)
  assert.equal(keyToAction({ key: 'j', ctrlKey: true }), null)
  assert.equal(keyToAction({ key: 'j', target: { tagName: 'INPUT' } }), null)
  assert.equal(keyToAction({ key: '1', target: { tagName: 'DIV', isContentEditable: true } }), null)
})

test('move clamps within results', () => {
  let s = initialAnnotationState(results)
  s = annotationReducer(s, { type: 'move', delta: -1 })
  assert.equal(s.cursor, 0)
  s = annotationReducer(s, { type: 'move', delta: 1 })
  s = annotationReducer(s, { type: 'move', delta: 1 })
  s = annotationReducer(s, { type: 'move', delta: 1 })
  assert.equal(s.cursor, 2)
  const empty = initialAnnotationState([])
  assert.equal(annotationReducer(empty, { type: 'move', delta: 1 }), empty)
})

test('grade records and advances the cursor', () => {
  let s = initialAnnotationState(results, { C: 0 })
  s = annotationReducer(s, { type: 'grade', grade: 2 })
  assert.deepEqual(s.grades, { A: 2, C: 0 })
  assert.equal(s.cursor, 1)
  assert.deepEqual(s.lastGraded, { id: 'A', grade: 2 })
  s = annotationReducer(s, { type: 'grade', grade: 7 })
  assert.deepEqual(s.grades, { A: 2, C: 0 })
  s = annotationReducer(s, { type: 'grade', grade: 1, id: 'C' })
  assert.equal(s.cursor, 1, 'grading a non-focused row by click does not move the cursor')
  assert.deepEqual(progress(s), { graded: 2, total: 3 })
  s = annotationReducer({ ...s, cursor: 2 }, { type: 'grade', grade: 1 })
  assert.equal(s.cursor, 2)
})

test('focus, revert and reset', () => {
  let s = initialAnnotationState(results)
  s = annotationReducer(s, { type: 'focus', id: 'C' })
  assert.equal(s.cursor, 2)
  assert.equal(annotationReducer(s, { type: 'focus', id: 'Z' }), s)
  s = annotationReducer(s, { type: 'grade', grade: 1 })
  s = annotationReducer(s, { type: 'revert', id: 'C', previous: null })
  assert.deepEqual(s.grades, {})
  s = annotationReducer(s, { type: 'reset', results: [{ product_id: 'X' }], existing: { X: 2 } })
  assert.deepEqual(s, { ids: ['X'], cursor: 0, grades: { X: 2 }, lastGraded: null })
})

test('gradesFromJudgments', () => {
  assert.deepEqual(gradesFromJudgments([{ product_id: 'A', grade: 1 }, null]), { A: 1 })
})
