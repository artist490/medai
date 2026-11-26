// Логотип-связка: знак + название. Единственное место, где знак клиники
// используется в интерфейсе, поэтому его вид задан один раз.
import { brand } from '../brand'

export default function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 min-w-0">
      <span
        aria-hidden
        className="inline-flex items-center justify-center shrink-0"
        style={{
          width: compact ? 26 : 30,
          height: compact ? 26 : 30,
          borderRadius: 7,
          background: 'var(--color-teal-dark)',
        }}
      >
        <svg width={compact ? 15 : 17} height={compact ? 15 : 17} viewBox="0 0 18 18" fill="none">
          <circle cx="9" cy="9" r="3.2" fill="#fff" />
          <circle cx="9" cy="9" r="6.8" stroke="rgba(255,255,255,0.45)" strokeWidth="1.4" />
        </svg>
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold tracking-[-0.015em] text-ink leading-tight truncate">
          {brand.name}
        </span>
        {!compact && (
          <span className="block text-[10px] uppercase tracking-[0.06em] text-ink-soft mt-0.5 truncate">
            {brand.subtitle}
          </span>
        )}
      </span>
    </span>
  )
}
