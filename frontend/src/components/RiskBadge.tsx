import type { RiskLevel } from '../types'

const config = {
  green: { cls: 'badge-green', emoji: '✅', text: 'Всё в норме' },
  yellow: { cls: 'badge-gold', emoji: '⚠️', text: 'Есть замечания' },
  red: { cls: 'badge-red', emoji: '🚨', text: 'Тревога — к врачу' },
} as const

export default function RiskBadge({ level, big = false }: { level: RiskLevel; big?: boolean }) {
  const c = config[level]
  return (
    <span className={`${c.cls} badge ${big ? 'text-sm px-5 py-2' : ''}`}>
      <span aria-hidden>{c.emoji}</span>
      {c.text}
    </span>
  )
}
