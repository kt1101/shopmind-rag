// Turns any API failure into something a shopper can read. The backend error body is
// {error: {code, message}} (docs/API_CONTRACT.md); `request` copies `status` and `code` onto
// the thrown Error. Raw messages (e.g. "OPENAI_API_KEY is not configured") are developer text
// and never shown as the headline.

// kind -> i18n keys under `error.*` (title + plain explanation).
export const ERROR_KINDS = ['llm_unavailable', 'network', 'timeout', 'rate_limited', 'not_found', 'invalid', 'server', 'stream', 'unknown']

export function errorKind(error) {
  if (!error) return 'unknown'
  const code = String(error.code || '').toLowerCase()
  const status = Number(error.status) || 0
  if (code === 'llm_unavailable' || code === 'llm_disabled' || code === 'llm_error') return 'llm_unavailable'
  if (code === 'stream_incomplete') return 'stream'
  if (error.name === 'TimeoutError' || code === 'timeout' || status === 504) return 'timeout'
  if (status === 429 || code === 'rate_limited') return 'rate_limited'
  if (status === 404) return 'not_found'
  if (status === 400 || status === 422) return 'invalid'
  if (status >= 500) return 'server'
  // fetch() rejects with a TypeError when the server cannot be reached or the stream drops.
  if (!status && (error.name === 'TypeError' || /failed to fetch|network|load failed|connection/i.test(error.message || ''))) return 'network'
  return 'unknown'
}

// {kind, title, message, retryable, detail}. `t` is the i18n translate function.
export function describeError(error, t) {
  const kind = errorKind(error)
  const detail = error?.message && !/^Request failed \(\d+\)$/.test(error.message) ? error.message : null
  return {
    kind,
    title: t(`error.${kind}.title`),
    message: t(`error.${kind}.message`),
    // Retrying cannot help when the feature is switched off or the input is invalid.
    retryable: !['llm_unavailable', 'invalid', 'not_found'].includes(kind),
    detail,
  }
}
