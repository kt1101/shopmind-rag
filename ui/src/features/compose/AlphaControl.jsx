import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from '../../shared/ui/I18nProvider.jsx'
import './compose.css'

// F1 image weight α. Moving the slider re-queries live (debounced) via onChange.
export default function AlphaControl({ value, onChange, debounceMs = 220, busy = false }) {
  const { t } = useI18n()
  const id = useId()
  const [local, setLocal] = useState(value)
  const timer = useRef(null)

  useEffect(() => setLocal(value), [value])
  useEffect(() => () => clearTimeout(timer.current), [])

  function update(next) {
    const alpha = Math.round(Number(next) * 100) / 100
    setLocal(alpha)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onChange?.(alpha), debounceMs)
  }

  const imagePct = Math.round(local * 100)
  return (
    <section className="compose-control" aria-labelledby={`${id}-title`}>
      <div className="compose-control-head">
        <h2 id={`${id}-title`}>{t('compose.title')}</h2>
        <code className="compose-formula">{t('compose.formula')}</code>
      </div>
      <label htmlFor={id} className="compose-alpha-label">
        {t('compose.alpha', { alpha: local.toFixed(2) })}
        {busy && <span className="compose-busy" aria-hidden="true" />}
      </label>
      <div className="compose-slider-row">
        <span className="sm-small sm-muted">{t('compose.textSide')}</span>
        <input
          id={id}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={local}
          onChange={(e) => update(e.target.value)}
          aria-valuetext={`α = ${local.toFixed(2)}`}
        />
        <span className="sm-small sm-muted">{t('compose.imageSide')}</span>
      </div>
      <div className="compose-weights" aria-hidden="true">
        <span className="compose-weight-image" style={{ width: `${imagePct}%` }}>{imagePct > 12 ? t('compose.imageShare', { pct: imagePct }) : ''}</span>
        <span className="compose-weight-text" style={{ width: `${100 - imagePct}%` }}>{100 - imagePct > 12 ? t('compose.textShare', { pct: 100 - imagePct }) : ''}</span>
      </div>
      <p className="sm-small sm-muted">{t('compose.explain')}</p>
    </section>
  )
}
