import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_FAILURES, POLL_INTERVAL_MS, initialPollState, isActiveJob, nextPollDelay, pollReducer } from './jobPolling.js'

const running = { id: 'j1', status: 'running' }
const done = { id: 'j2', status: 'succeeded' }

test('isActiveJob', () => {
  assert.equal(isActiveJob({ status: 'queued' }), true)
  assert.equal(isActiveJob({ status: 'running' }), true)
  assert.equal(isActiveJob({ status: 'failed' }), false)
  assert.equal(isActiveJob(null), false)
})

test('loads then polls while a job is active', () => {
  let s = pollReducer(initialPollState, { type: 'fetch' })
  assert.equal(s.status, 'loading')
  assert.equal(nextPollDelay(s), null)
  s = pollReducer(s, { type: 'success', jobs: [running, done], at: 1 })
  assert.equal(s.status, 'polling')
  assert.equal(nextPollDelay(s), POLL_INTERVAL_MS)
  assert.equal(pollReducer(s, { type: 'fetch' }), s, 'background refetch keeps status')
  s = pollReducer(s, { type: 'success', jobs: [{ ...running, status: 'succeeded' }, done] })
  assert.equal(s.status, 'settled')
  assert.equal(nextPollDelay(s), null)
})

test('starting a job resumes polling', () => {
  let s = pollReducer(initialPollState, { type: 'success', jobs: [done] })
  assert.equal(s.status, 'settled')
  s = pollReducer(s, { type: 'jobUpdated', job: { id: 'j3', status: 'queued' } })
  assert.equal(s.status, 'polling')
  assert.equal(s.jobs[0].id, 'j3')
  s = pollReducer(s, { type: 'jobUpdated', job: { id: 'j3', status: 'failed' } })
  assert.equal(s.status, 'settled')
  assert.equal(s.jobs.length, 2)
})

test('failures back off then error out', () => {
  let s = pollReducer(initialPollState, { type: 'success', jobs: [running] })
  s = pollReducer(s, { type: 'failure', error: new Error('x') })
  assert.equal(s.status, 'polling')
  assert.equal(nextPollDelay(s), POLL_INTERVAL_MS * 2)
  for (let i = 1; i < MAX_FAILURES; i += 1) s = pollReducer(s, { type: 'failure', error: new Error('x') })
  assert.equal(s.status, 'error')
  assert.equal(nextPollDelay(s), null)
  s = pollReducer(s, { type: 'fetch' })
  assert.equal(s.status, 'loading')
  s = pollReducer(s, { type: 'success', jobs: [] })
  assert.equal(s.failures, 0)
})

test('initial failure without data is an error', () => {
  const s = pollReducer(pollReducer(initialPollState, { type: 'fetch' }), { type: 'failure', error: new Error('boom') })
  assert.equal(s.status, 'error')
})

test('stop settles polling', () => {
  const s = pollReducer(pollReducer(initialPollState, { type: 'success', jobs: [running] }), { type: 'stop' })
  assert.equal(s.status, 'settled')
  assert.equal(nextPollDelay(s), null)
})
