import { ReactNode } from 'react'

// Единая шапка страницы: метка, заголовок, подпись, действия справа.
// Один масштаб заголовка и одни отступы на всех страницах.
export default function PageHeader({ eyebrow, title, sub, actions }: {
  eyebrow?: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-5 border-b border-line">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {sub && (
          <p className="text-[13px] text-ink-soft mt-2 max-w-[62ch] leading-relaxed">
            {sub}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}
