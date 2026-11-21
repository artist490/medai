import type { Finding } from '../types'

// Карточка показателя с левой акцент-полосой цвета статуса (Flip7)
const statusClass = {
  ok: 'flip-card--ok',
  warn: 'flip-card--coral',
  alarm: 'flip-card--danger',
} as const

const statusBadge = {
  ok: { cls: 'badge-green', text: 'норма' },
  warn: { cls: 'badge-gold', text: 'внимание' },
  alarm: { cls: 'badge-red', text: 'тревога' },
} as const

export default function IndicatorCard({ finding }: { finding: Finding }) {
  const badge = statusBadge[finding.status]
  return (
    <div className={`flip-card ${statusClass[finding.status]}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-extrabold text-teal-dark">{finding.label}</span>
        <span className={`${badge.cls} badge`}>{badge.text}</span>
      </div>
      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-2xl font-extrabold text-teal-dark">{finding.value}</span>
        <span className="text-xs text-ink-soft font-bold">{finding.unit}</span>
        <span className="ml-auto text-[11px] text-ink-soft font-bold">
          норма: {finding.norm}
        </span>
      </div>
      <p className="text-sm text-ink-soft">{finding.message}</p>
    </div>
  )
}
