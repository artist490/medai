// Единый компонент иконок: моно-линейный SVG-набор (штрих 1.7px, currentColor).
// Один визуальный слой: иконка наследует цвет текста контейнера — тинтовые
// плитки, статусы и тёмные панели работают без отдельных раскрасок.
import type { ReactNode } from 'react'

export type IconName =
  | 'home' | 'stethoscope' | 'chart' | 'profile'
  | 'search' | 'bell' | 'help'
  | 'pressure' | 'pulse' | 'temperature' | 'lungs'
  | 'scale' | 'sleep' | 'steps' | 'water'
  | 'robot' | 'warning'
  | 'cross' | 'check' | 'alarm' | 'trash'
  | 'bulb' | 'run' | 'salad' | 'clock'
  | 'lock' | 'wave' | 'rocket' | 'sparkle'
  | 'party' | 'male' | 'female' | 'care'
  | 'close' | 'chevron' | 'chevron-left'

// 24×24, stroke 1.7, скруглённые концы — единая пластика всего набора
const glyphs: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M5 2.5v5a5 5 0 0 0 10 0v-5" />
      <path d="M10 12.5V15a6 6 0 0 0 11.5 2.3" />
      <circle cx="21.3" cy="9.8" r="1.9" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20.5h16" />
      <path d="M7.5 20.5v-5.5" />
      <path d="M12 20.5V8.5" />
      <path d="M16.5 20.5v-9" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c.6-4 3.4-6 7.5-6s6.9 2 7.5 6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 20.5 20.5" />
    </>
  ),
  bell: (
    <>
      <path d="M17.8 9.5a5.8 5.8 0 0 0-11.6 0c0 4.5-1.9 6-1.9 6h15.4s-1.9-1.5-1.9-6" />
      <path d="M10.3 19a2 2 0 0 0 3.4 0" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M9.4 9.6a2.6 2.6 0 1 1 3.7 2.4c-.7.3-1.1.8-1.1 1.6v.4" />
      <path d="M12 17.1h.01" />
    </>
  ),
  pressure: (
    <>
      <path d="M4.5 14.5a7.5 7.5 0 0 1 15 0" />
      <path d="M12 14.5l3.2-3.2" />
      <circle cx="12" cy="14.5" r="1.3" />
      <path d="M3.5 18.5h17" />
    </>
  ),
  pulse: (
    <path d="M3 12.5h3.5l2-4.5 3 9 2.5-6.5 1.5 2H21" />
  ),
  temperature: (
    <>
      <path d="M10.5 4.5a1.8 1.8 0 0 1 3.6 0v8.2a4.2 4.2 0 1 1-3.6 0z" />
      <path d="M12.3 10.5v5.2" />
      <circle cx="12.3" cy="17.2" r="1" />
    </>
  ),
  lungs: (
    <>
      <path d="M12 3.5v6" />
      <path d="M12 9.5c-.4 0-.8.06-1.2.18C7 10.8 4.5 14 4.5 18v2.5h5A2.5 2.5 0 0 0 12 18V9.5z" />
      <path d="M12 9.5c.4 0 .8.06 1.2.18C17 10.8 19.5 14 19.5 18v2.5h-5A2.5 2.5 0 0 1 12 18V9.5z" />
    </>
  ),
  scale: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 9a3.5 3.5 0 0 1 7 0" />
      <path d="M12 9l2.4-2.2" />
    </>
  ),
  sleep: (
    <path d="M20 14.2A8.3 8.3 0 1 1 9.8 4 6.6 6.6 0 0 0 20 14.2z" />
  ),
  steps: (
    <>
      <path d="M7.4 4c1.3 0 2.2 1.1 2 2.5l-.4 2.8c-.1.9-.8 1.5-1.6 1.5s-1.5-.6-1.6-1.5L5.4 6.5C5.2 5.1 6.1 4 7.4 4z" />
      <circle cx="7.4" cy="12.7" r="1.1" />
      <path d="M16.6 9.5c1.3 0 2.2 1.1 2 2.5l-.4 2.8c-.1.9-.8 1.5-1.6 1.5s-1.5-.6-1.6-1.5l-.4-2.8c-.2-1.4.7-2.5 2-2.5z" />
      <circle cx="16.6" cy="18.2" r="1.1" />
    </>
  ),
  water: (
    <>
      <path d="M12 3.8S6.2 10.2 6.2 14.3a5.8 5.8 0 0 0 11.6 0C17.8 10.2 12 3.8 12 3.8z" />
      <path d="M9.2 14.5a2.8 2.8 0 0 0 2.8 2.8" />
    </>
  ),
  robot: (
    <>
      <rect x="4.5" y="7.5" width="15" height="11" rx="3" />
      <path d="M12 4.5v3" />
      <circle cx="12" cy="3.4" r="1.1" />
      <path d="M9 12.2h.01" />
      <path d="M15 12.2h.01" />
      <path d="M9.5 15.3h5" />
    </>
  ),
  warning: (
    <>
      <path d="M10.4 4.2a1.9 1.9 0 0 1 3.2 0l7 12.1a1.9 1.9 0 0 1-1.6 2.8H5a1.9 1.9 0 0 1-1.6-2.8z" />
      <path d="M12 9.5v4" />
      <path d="M12 16.4h.01" />
    </>
  ),
  cross: (
    <path d="M9.6 4.5h4.8v5.1h5.1v4.8h-5.1v5.1H9.6v-5.1H4.5V9.6h5.1z" />
  ),
  check: (
    <path d="M5 12.8l4.3 4.4L19 7.2" />
  ),
  alarm: (
    <>
      <path d="M17.3 9.8a5.3 5.3 0 0 0-10.6 0c0 4.2-1.8 5.6-1.8 5.6h14.2s-1.8-1.4-1.8-5.6" />
      <path d="M10.4 18.8a1.9 1.9 0 0 0 3.2 0" />
      <path d="M3.5 8.2A9.5 9.5 0 0 1 6 4.3" />
      <path d="M20.5 8.2a9.5 9.5 0 0 0-2.5-3.9" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.3 7V5.6c0-.9.7-1.6 1.6-1.6h2.2c.9 0 1.6.7 1.6 1.6V7" />
      <path d="M6.3 7l.9 12.3c.1 1 .9 1.7 1.9 1.7h5.8c1 0 1.8-.7 1.9-1.7L17.7 7" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  bulb: (
    <>
      <path d="M9.2 17.5h5.6" />
      <path d="M10.2 20.5h3.6" />
      <path d="M12 3.5a6.2 6.2 0 0 1 3.8 11.1c-.7.6-1.3 1.7-1.3 2.9h-5c0-1.2-.6-2.3-1.3-2.9A6.2 6.2 0 0 1 12 3.5z" />
    </>
  ),
  run: (
    <>
      <circle cx="14.2" cy="4.6" r="1.9" />
      <path d="M13.4 7.8l-2.8 3.8 3.2 2.3-1.4 6.4" />
      <path d="M13.4 7.8l3 2.6 3.4.6" />
      <path d="M13.8 13.9l2.8 2.8.9 3.6" />
      <path d="M10.6 11.6 7.5 13l-2.2 2.8" />
    </>
  ),
  salad: (
    <>
      <path d="M19.8 4.2c.4 8.7-4.3 14.6-13.6 15.3-.5-9.3 4.4-14.7 13.6-15.3z" />
      <path d="M6.6 19.1C8.8 13.8 12.5 10.2 17 8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.2V12l3.4 2" />
    </>
  ),
  lock: (
    <>
      <rect x="5.2" y="10.8" width="13.6" height="9.7" rx="2.6" />
      <path d="M8.3 10.8V8.2a3.7 3.7 0 0 1 7.4 0v2.6" />
      <path d="M12 14.6v2" />
    </>
  ),
  wave: (
    <>
      <path d="M8.2 12.8V6.2a1.4 1.4 0 0 1 2.8 0v5.6" />
      <path d="M11 11.8V5a1.4 1.4 0 0 1 2.8 0v6.8" />
      <path d="M13.8 11.8V6.4a1.4 1.4 0 0 1 2.8 0V13" />
      <path d="M16.6 13v-1.4a1.4 1.4 0 0 1 2.8 0v3.6a6.2 6.2 0 0 1-6.2 6.2h-1a6.2 6.2 0 0 1-5.3-3l-3-4.9a1.5 1.5 0 0 1 2.5-1.6l1.8 2.4" />
    </>
  ),
  rocket: (
    <>
      <path d="M12 3.2c3.1 1.6 5 5 5 9.3l-2.4 2.4H9.4L7 12.5c0-4.3 1.9-7.7 5-9.3z" />
      <circle cx="12" cy="9.6" r="1.7" />
      <path d="M9.4 15l-2.2 2.2" />
      <path d="M14.6 15l2.2 2.2" />
      <path d="M12 17.6v2.9" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" />
      <path d="M18.6 16.8l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>
  ),
  party: (
    <>
      <path d="M5.6 14.2 9.8 18.4 4.2 20z" />
      <path d="M9.2 11.5c1.3-2.9 3.6-4.9 7-5.9" />
      <path d="M11.4 14.3c1.9-.4 3.7-1.6 5.2-3.6" />
      <path d="M6.4 10.5h.01" />
      <path d="M13 19.8h.01" />
      <path d="M17.8 17.3h.01" />
      <path d="M19.5 10.8h.01" />
    </>
  ),
  male: (
    <>
      <circle cx="10" cy="13.5" r="5" />
      <path d="M13.6 10 20 3.6" />
      <path d="M15.2 3.5h5.3v5.3" />
    </>
  ),
  female: (
    <>
      <circle cx="12" cy="8.8" r="5" />
      <path d="M12 13.8V21" />
      <path d="M9 18h6" />
    </>
  ),
  care: (
    <>
      <path d="M12 20.2S4.8 16 3.2 11.4A4.9 4.9 0 0 1 12 7a4.9 4.9 0 0 1 8.8 4.4C19.2 16 12 20.2 12 20.2z" />
      <path d="M7.2 12h2.3l1.2-2 1.8 3.6 1.2-1.6h2.1" />
    </>
  ),
  close: (
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  ),
  chevron: (
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  ),
  'chevron-left': (
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  ),
}

export function Icon({ name, size = 20, className }: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={`inline-block select-none shrink-0 ${className ?? ''}`}
      style={{ verticalAlign: 'middle' }}
    >
      {glyphs[name]}
    </svg>
  )
}
