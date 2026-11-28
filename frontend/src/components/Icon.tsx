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
  | 'lock' | 'login' | 'arrow' | 'send' | 'sparkle'
  | 'user-plus' | 'male' | 'female' | 'care'
  | 'close' | 'chevron' | 'chevron-left' | 'doc' | 'download' | 'calendar'
  | 'edit'

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
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <circle cx="9" cy="10.4" r="2.1" />
      <path d="M6.5 16.1c.5-1.7 1.6-2.6 3.2-2.6" />
      <path d="M14 10h3.6" />
      <path d="M14 13.4h3.6" />
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
      <path d="M12 3.5v5.4" />
      <path d="M12 8.9c-.6 2.5-2.3 2.9-2.3 5.6" />
      <path d="M12 8.9c.6 2.5 2.3 2.9 2.3 5.6" />
      <path d="M9.7 12.3c-2.9.7-5 3.9-5 7.2h3.5c1.6 0 2.9-1.3 2.9-2.9v-6.6" />
      <path d="M14.3 12.3c2.9.7 5 3.9 5 7.2h-3.5c-1.6 0-2.9-1.3-2.9-2.9v-6.6" />
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
      <path d="M8.4 3.5c1.4 0 2.35 1.15 2.2 2.75l-.3 3.3c-.1 1-.9 1.75-1.9 1.75s-1.8-.75-1.9-1.75l-.3-3.3C6.05 4.65 7 3.5 8.4 3.5z" />
      <rect x="6.7" y="13.1" width="3.4" height="4.3" rx="1.6" />
      <path d="M15.7 8.7c1.4 0 2.35 1.15 2.2 2.75l-.3 3.3c-.1 1-.9 1.75-1.9 1.75s-1.8-.75-1.9-1.75l-.3-3.3c-.15-1.6.8-2.75 2.2-2.75z" />
      <rect x="14" y="18.3" width="3.4" height="4.2" rx="1.6" />
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
  login: (
    <>
      <path d="M14 3.5h4.5A2.5 2.5 0 0 1 21 6v12a2.5 2.5 0 0 1-2.5 2.5H14" />
      <path d="M3.5 12h10" />
      <path d="M9.5 8l4 4-4 4" />
    </>
  ),
  arrow: (
    <>
      <path d="M4.5 12h15" />
      <path d="M13.5 6l6 6-6 6" />
    </>
  ),
  send: (
    <>
      <path d="M21.5 2.5 11 13" />
      <path d="M21.5 2.5 14.5 21l-3.5-8-8-3.5z" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" />
      <path d="M18.6 16.8l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>
  ),
  'user-plus': (
    <>
      <circle cx="9.5" cy="8" r="3.6" />
      <path d="M3.5 20c.7-3.4 3-5.2 6-5.2 1.5 0 2.8.4 3.9 1.2" />
      <path d="M18.5 6.5v5" />
      <path d="M16 9h5" />
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
  doc: (
    <path d="M7 3.5h7l4 4v13H7z M14 3.5v4h4 M9.5 12h5 M9.5 15.5h5" />
  ),
  edit: (
    <>
      <path d="M4.5 19.5l1.2-4.1L16.9 4.2a1.9 1.9 0 0 1 2.7 0l.2.2a1.9 1.9 0 0 1 0 2.7L8.6 18.3l-4.1 1.2z" />
      <path d="M14.6 6.5l3 3" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14.5" rx="2.6" />
      <path d="M4 10h16" />
      <path d="M8.5 3.5v3.5" />
      <path d="M15.5 3.5v3.5" />
    </>
  ),
  download: (
    <path d="M12 4v10 M7.5 10.5 12 15l4.5-4.5 M5 18.5h14" />
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
