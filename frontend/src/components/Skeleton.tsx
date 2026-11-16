import { CSSProperties } from 'react'

// Скелетоны загрузки: повторяют форму будущего контента вместо
// текстовой «Загрузка…». Базовые блоки + панель и таблица.

export function Skeleton({ w, h = 12, r, className = '', style }: {
  w?: number | string
  h?: number | string
  r?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width: w, height: h, borderRadius: r, ...style }}
      aria-hidden
    />
  )
}

// Заглушка в форме .panel (как секции страниц)
export function SkeletonCard({ lines = 3, className = '' }: {
  lines?: number
  className?: string
}) {
  return (
    <div className={`panel flex flex-col gap-3.5 ${className}`} aria-hidden>
      <Skeleton w="42%" h={11} />
      <Skeleton w="62%" h={24} r={10} />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} w={`${86 - i * 16}%`} h={11} />
      ))}
    </div>
  )
}

// Заглушка таблицы/списка: шапка + строки с аватаром и действиями
export function SkeletonRows({ rows = 5, className = '' }: {
  rows?: number
  className?: string
}) {
  return (
    <div className={`panel ${className}`} aria-hidden>
      <div className="flex flex-col gap-5">
        <div className="flex gap-6">
          <Skeleton w={90} h={11} />
          <Skeleton w={70} h={11} />
          <Skeleton w={70} h={11} />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton w={40} h={40} r={999} />
            <Skeleton w={`${30 - (i % 3) * 4}%`} h={13} />
            <Skeleton w="22%" h={11} />
            <Skeleton w={90} h={26} r={8} className="ml-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
