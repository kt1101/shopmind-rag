// Incremental Server-Sent Events parser (text/event-stream). Feed decoded text chunks with
// `push`, call `flush` at end of stream. Each complete event is delivered as
// {event, data, id?} where `data` is parsed JSON when possible (raw string otherwise).
// Comments (":" lines), unknown fields and unknown event names are tolerated; the consumer
// decides which events it understands.

export function createSSEParser(onEvent) {
  let buffer = ''
  let eventName = ''
  let dataLines = []
  let lastId

  function dispatch() {
    if (!dataLines.length && !eventName) return
    const raw = dataLines.join('\n')
    let data = raw
    if (raw) {
      try {
        data = JSON.parse(raw)
      } catch {
        data = raw
      }
    }
    const evt = { event: eventName || 'message', data }
    if (lastId !== undefined) evt.id = lastId
    eventName = ''
    dataLines = []
    onEvent(evt)
  }

  function processLine(line) {
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
    else if (field === 'id') lastId = value
    // `retry` and unknown fields are ignored.
  }

  return {
    push(chunk) {
      buffer += chunk
      // A trailing CR may be the first half of CRLF split across chunks: keep it buffered.
      const lines = buffer.split(/\r\n|\r(?!$)|\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) processLine(line)
    },
    flush() {
      if (buffer) {
        processLine(buffer.replace(/\r$/, ''))
        buffer = ''
      }
      dispatch()
    },
  }
}

export function parseSSEText(text) {
  const events = []
  const parser = createSSEParser((evt) => events.push(evt))
  parser.push(text)
  parser.flush()
  return events
}
