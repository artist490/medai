// Общие типы и хелперы вкладок медкарты (разделено из MedCard.tsx, F008)
import type { IconName } from '../../components/Icon'
import type { VisitStatus } from '../../types'

export type CardTab = 'overview' | 'anamnesis' | 'meas' | 'docs'

export const TABS: Array<{ id: CardTab; label: string; icon: IconName }> = [
  { id: 'overview', label: 'Обзор карты', icon: 'home' },
  { id: 'anamnesis', label: 'Анкета', icon: 'check' },
  { id: 'meas', label: 'Замеры', icon: 'chart' },
  { id: 'docs', label: 'Документы', icon: 'doc' },
]

export const STATUS_INFO: Record<VisitStatus, { cls: string; label: string }> = {
  planned: { cls: 'badge-teal', label: 'Запланирован' },
  completed: { cls: 'badge-green', label: 'Завершён' },
  cancelled: { cls: 'badge', label: 'Отменён' },
}

export function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

// Справочник категорий документов (дубликат doc_categories.py, порядок тот же);
// общий для вкладки документов пациента и врача (F008: дубликаты — во shared)
export const DOC_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'blood', label: 'Кровь' },
  { key: 'hormones', label: 'Гормоны и биохимия' },
  { key: 'urine', label: 'Моча' },
  { key: 'stool', label: 'Кал' },
  { key: 'smears', label: 'Мазки и цитология' },
  { key: 'imaging', label: 'МРТ, КТ, УЗИ и рентген' },
  { key: 'function', label: 'ЭКГ и функциональная диагностика' },
  { key: 'other', label: 'Прочее' },
]

export function categoryLabel(key: string): string {
  return DOC_CATEGORIES.find((c) => c.key === key)?.label ?? 'Прочее'
}
