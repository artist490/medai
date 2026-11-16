import { ReactNode, useRef } from 'react'
import { useFlowIndicatorStyle, useFlowRect } from './useFlowRect'

// Переключатель-вкладки: активная заливка не переключается мгновенно,
// а плавно перетекает с одной кнопки на другую (скользящая пилюля).
// Сама заливка — общий .flow-indicator позади кнопок.
export default function FlowTabs<T extends string>({ items, value, onChange, ariaLabel }: {
  items: Array<{ id: T; label: ReactNode; icon?: ReactNode }>
  value: T
  onChange: (id: T) => void
  ariaLabel?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const rect = useFlowRect(boxRef, '[data-flow-active="1"]', value)
  const indicatorStyle = useFlowIndicatorStyle(rect)

  return (
    <div ref={boxRef} className="flow-box flex gap-2 flex-wrap" role="tablist" aria-label={ariaLabel}>
      <span className="flow-indicator flow-indicator--pill" style={indicatorStyle} aria-hidden />
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          data-flow-active={value === it.id ? '1' : undefined}
          onClick={() => onChange(it.id)}
          className={`btn btn-sm btn-pill flow-tab ${value === it.id ? 'active' : ''}`}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}
