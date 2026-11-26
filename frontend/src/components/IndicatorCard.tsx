import type { Finding } from '../types'

// Показатель в разборе замера: значение, норма и статус. Маркер слева —
// только у отклонений, чтобы глаз находил их без чтения текста.
const statusClass = {
  ok: '',
  warn: 'flip-card--warn',
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink">{finding.label}</span>
        <span className={`${badge.cls} badge`}>{badge.text}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-2">
        <span className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums">{finding.value}</span>
        <span className="text-[12px] text-ink-soft">{finding.unit}</span>
        <span className="ml-auto text-[11.5px] text-ink-soft tabular-nums">
          норма {finding.norm}
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-soft mt-2">{finding.message}</p>
    </div>
  )
}
