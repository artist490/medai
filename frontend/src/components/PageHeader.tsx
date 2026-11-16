import { ReactNode } from 'react'

// Единая шапка страницы: eyebrow + заголовок + подпись + действия справа.
// Один масштаб заголовка и одни отступы на всех страницах.
export default function PageHeader({ eyebrow, title, sub, actions }: {
  eyebrow?: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="mt-1 leading-tight" style={{ fontSize: 'clamp(26px, 4vw, 32px)', letterSpacing: '-0.02em' }}>
          {title}
        </h1>
        {sub && <p className="text-sm text-teal-dark/60 mt-1.5">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </div>
  )
}
