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
  // тихий статус: своя иконка вместо точки .badge, без заливки-пилюли
  return (
    <span className={`${c.cls} inline-flex items-center gap-1.5 font-semibold ${big ? 'text-sm' : ''}`}>
      <Icon name={c.icon as IconName} size={big ? 16 : 14} className="align-[-2px]" />
      {c.text}
    </span>
  )
}
