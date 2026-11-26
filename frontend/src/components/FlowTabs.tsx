import { KeyboardEvent, ReactNode, useRef } from 'react'
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const rect = useFlowRect(boxRef, '[data-flow-active="1"]', value)
  const indicatorStyle = useFlowIndicatorStyle(rect)

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = (index - 1 + items.length) % items.length
        break
      case 'ArrowRight':
        nextIndex = (index + 1) % items.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = items.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const nextItem = items[nextIndex]
    if (!nextItem) return
    onChange(nextItem.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <div ref={boxRef} className="flow-box flex gap-2 flex-wrap" role="tablist" aria-label={ariaLabel}>
      <span className="flow-indicator flow-indicator--pill" style={indicatorStyle} aria-hidden />
      {items.map((it, index) => (
        <button
          key={it.id}
          ref={(element) => { tabRefs.current[index] = element }}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          tabIndex={value === it.id ? 0 : -1}
          data-flow-active={value === it.id ? '1' : undefined}
          onClick={() => onChange(it.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={`btn btn-sm btn-pill flow-tab ${value === it.id ? 'active' : ''}`}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  )
}
