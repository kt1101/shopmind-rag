import './ui.css'

export function Skeleton({ lines = 3, className = '' }) {
  return (
    <div className={`sm-skeleton ${className}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="sm-skeleton-line" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  )
}

export function SkeletonBlock({ height = 120, className = '' }) {
  return <div className={`sm-skeleton-block ${className}`} style={{ height }} aria-hidden="true" />
}
