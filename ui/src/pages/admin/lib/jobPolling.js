// Job polling state machine. Polls every 3s while any job is queued/running; stops when
// all are settled; backs off on transient errors and gives up after MAX_FAILURES.
//
// status: 'idle' -> 'loading' -> 'polling' | 'settled' | 'error'

export const POLL_INTERVAL_MS = 3000
export const MAX_FAILURES = 3
export const ACTIVE_STATUSES = ['queued', 'running']

export function isActiveJob(job) {
  return ACTIVE_STATUSES.includes(job?.status)
}

export const initialPollState = { status: 'idle', jobs: [], error: null, failures: 0, lastUpdated: null }

function statusFor(jobs) {
  return jobs.some(isActiveJob) ? 'polling' : 'settled'
}

function upsert(jobs, job) {
  const index = jobs.findIndex((j) => j.id === job.id)
  if (index < 0) return [job, ...jobs]
  const next = jobs.slice()
  next[index] = { ...jobs[index], ...job }
  return next
}

export function pollReducer(state, action) {
  switch (action.type) {
    case 'fetch':
      return state.status === 'idle' || state.status === 'error' ? { ...state, status: 'loading', error: null } : state
    case 'success': {
      const jobs = action.jobs || []
      return { status: statusFor(jobs), jobs, error: null, failures: 0, lastUpdated: action.at ?? null }
    }
    case 'jobUpdated': {
      const jobs = upsert(state.jobs, action.job)
      return { ...state, jobs, status: state.status === 'loading' ? 'loading' : statusFor(jobs) }
    }
    case 'failure': {
      const failures = state.failures + 1
      const hasData = state.jobs.length > 0
      if (failures >= MAX_FAILURES || !hasData) return { ...state, status: 'error', error: action.error, failures }
      // keep the last good list visible and retry with backoff
      return { ...state, status: 'polling', error: action.error, failures }
    }
    case 'stop':
      return state.status === 'polling' ? { ...state, status: 'settled' } : state
    default:
      return state
  }
}

// Delay before the next poll, or null when nothing should be scheduled.
export function nextPollDelay(state) {
  if (state.status !== 'polling') return null
  return state.failures > 0 ? POLL_INTERVAL_MS * 2 ** state.failures : POLL_INTERVAL_MS
}

export const JOB_TYPES = [
  { type: 'reindex_policies', label: 'Reindex policies', description: 'Re-embed published policies into a new policies_vN index and switch the alias.' },
  { type: 'run_eval', label: 'Run evaluation', description: 'Run evaluation.runner on the A1 benchmark and record an eval run.' },
  { type: 'build_embedding_map', label: 'Build embedding map', description: 'Project product embeddings to 2D for the Embedding Map.' },
]
