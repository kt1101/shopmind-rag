// Inline citation markers in RAG answers. The answer text may reference citations as
// "[c1]", "[c1][c2]" or "[c1, c2]" where each id is a Citation.citation_id. Only ids that
// exist in `sources` become chips; anything else stays plain text.

const MARKER = /\[([A-Za-z0-9_:.-]+(?:\s*,\s*[A-Za-z0-9_:.-]+)*)\]/g

export function citationKey(source, index = 0) {
  return String(source?.citation_id ?? source?.document_id ?? `src-${index}`)
}

export function splitAnswer(answer, sources = []) {
  const text = String(answer ?? '')
  const known = new Map((sources || []).map((s, i) => [citationKey(s, i), s]))
  const segments = []
  let last = 0
  for (const match of text.matchAll(MARKER)) {
    const ids = match[1].split(',').map((id) => id.trim())
    if (!ids.every((id) => known.has(id))) continue
    if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) })
    for (const id of ids) segments.push({ type: 'cite', id, source: known.get(id) })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) })
  return mergeText(segments)
}

function mergeText(segments) {
  const out = []
  for (const seg of segments) {
    const prev = out[out.length - 1]
    if (seg.type === 'text' && prev?.type === 'text') prev.text += seg.text
    else out.push({ ...seg })
  }
  return out
}

// Citations that were never referenced inline (shown as chips under the answer).
export function unreferencedSources(answer, sources = []) {
  const used = new Set(splitAnswer(answer, sources).filter((s) => s.type === 'cite').map((s) => s.id))
  return (sources || []).filter((s, i) => !used.has(citationKey(s, i)))
}

// Short chip label: position of the citation among the sources (1-based), e.g. "1".
export function citationNumber(sources, id) {
  const index = (sources || []).findIndex((s, i) => citationKey(s, i) === id)
  return index === -1 ? null : index + 1
}
