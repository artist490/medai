import { Icon } from './Icon'
import type { IconName } from './Icon'
import type { RiskLevel } from '../types'

const config = {
  green: { cls: 'badge-green', icon: 'check', text: 'Всё в норме' },
  yellow: { cls: 'badge-gold', icon: 'warning', text: 'Есть замечания' },
  red: { cls: 'badge-red', icon: 'alarm', text: 'Тревога — к врачу' },
} as const

export default function RiskBadge({ level, big = false }: { level: RiskLevel; big?: boolean }) {
  const c = config[level]
  return (
    <span className={`${c.cls} badge ${big ? 'text-sm px-5 py-2' : ''}`}>
      <Icon name={c.icon as IconName} size={big ? 16 : 14} className="align-[-2px]" />
      {c.text}
    </span>
  )
}
