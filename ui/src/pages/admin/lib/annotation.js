// Keyboard-driven annotation state: j/k (or arrows) move the cursor, 0/1/2 grade the
// focused result and advance. The component persists grades; the reducer stays pure.

export const GRADES = [0, 1, 2]
export const GRADE_LABELS = { 0: 'Not relevant', 1: 'Partially relevant', 2: 'Relevant' }

export function initialAnnotationState(results = [], existing = {}) {
  return { ids: results.map((r) => r.product_id), cursor: 0, grades: { ...existing }, lastGraded: null }
}

// Maps a keyboard event-ish object to an action, or null when the key is not ours
// (or the user is typing in a form field / using a modifier).
export function keyToAction({ key, target, ctrlKey, metaKey, altKey } = {}) {
  if (ctrlKey || metaKey || altKey) return null
  const tag = target?.tagName?.toLowerCase?.()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return null
  if (key === 'j' || key === 'ArrowDown') return { type: 'move', delta: 1 }
  if (key === 'k' || key === 'ArrowUp') return { type: 'move', delta: -1 }
  if (key === '0' || key === '1' || key === '2') return { type: 'grade', grade: Number(key) }
  return null
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function annotationReducer(state, action) {
  switch (action.type) {
    case 'reset':
      return initialAnnotationState(action.results, action.existing)
    case 'move': {
      if (state.ids.length === 0) return state
      const cursor = clamp(state.cursor + action.delta, 0, state.ids.length - 1)
      return cursor === state.cursor ? state : { ...state, cursor }
    }
    case 'focus': {
      const cursor = state.ids.indexOf(action.id)
      return cursor < 0 ? state : { ...state, cursor }
    }
    case 'grade': {
      if (!GRADES.includes(action.grade)) return state
      const id = action.id ?? state.ids[state.cursor]
      if (id == null) return state
      const index = state.ids.indexOf(id)
      const advance = action.advance ?? true
      return {
        ...state,
        grades: { ...state.grades, [id]: action.grade },
        cursor: advance && index === state.cursor ? clamp(index + 1, 0, state.ids.length - 1) : state.cursor,
        lastGraded: { id, grade: action.grade },
      }
    }
    case 'revert': {
      // Undo a grade whose save failed.
      const grades = { ...state.grades }
      if (action.previous == null) delete grades[action.id]
      else grades[action.id] = action.previous
      return { ...state, grades }
    }
    default:
      return state
  }
}

export function progress(state) {
  const graded = state.ids.filter((id) => state.grades[id] != null).length
  return { graded, total: state.ids.length }
}

// Server judgments [{product_id, grade}] -> {product_id: grade}
export function gradesFromJudgments(items = []) {
  return Object.fromEntries(items.filter((j) => j && j.product_id != null).map((j) => [j.product_id, j.grade]))
}
