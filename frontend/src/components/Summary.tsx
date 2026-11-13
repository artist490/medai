// Сводка замера для таблиц: показатели с фирменными иконками вместо эмодзи.
import { Icon } from './Icon'
import type { IconName } from './Icon'
import type { Measurement } from '../types'

export function Summary({ m, size = 12 }: { m: Measurement; size?: number }) {
  const parts: Array<{ icon: IconName; text: string }> = []
  if (m.systolic != null) parts.push({ icon: 'pressure', text: `${m.systolic}/${m.diastolic ?? '—'}` })
  if (m.pulse != null) parts.push({ icon: 'pulse', text: String(m.pulse) })
  if (m.temperature != null) parts.push({ icon: 'temperature', text: `${m.temperature}°` })
  if (m.spo2 != null) parts.push({ icon: 'lungs', text: `${m.spo2}%` })
  if (m.weight_kg != null) parts.push({ icon: 'scale', text: `${m.weight_kg} кг` })
  if (m.sleep_hours != null) parts.push({ icon: 'sleep', text: `${m.sleep_hours} ч` })
  if (m.steps != null) parts.push({ icon: 'steps', text: String(m.steps) })
  if (m.water_ml != null) parts.push({ icon: 'water', text: String(m.water_ml) })

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {parts.map((p) => (
        <span key={p.icon} className="inline-flex items-center gap-1">
          <Icon name={p.icon} size={size} className="opacity-75" />
          {p.text}
        </span>
      ))}
    </span>
  )
}
