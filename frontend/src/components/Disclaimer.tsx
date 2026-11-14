// Обязательный дисклеймер на каждом результате анализа.
import { brand } from '../brand'
import { Icon } from './Icon'

export default function Disclaimer({ urgent = false, phone }: { urgent?: boolean; phone?: string }) {
  return (
    <div
      className={`rounded-xl p-3 text-xs leading-relaxed border-2 border-dashed ${
        urgent
          ? 'border-coral/40 bg-coral/5 text-coral-dark'
          : 'border-teal/25 bg-teal-bg/60 text-teal-dark/75'
      }`}
    >
      <Icon name="cross" size={12} className="inline-block align-[-1px] mr-1" />{brand.name} не ставит диагнозы и не заменяет консультацию врача. Рекомендации носят
      информационный характер по здоровому образу жизни. При тревожных показателях обратитесь
      к специалисту{urgent ? ` или позвоните в клинику: ${phone || brand.phone}` : ''}, при критических — 103.
    </div>
  )
}
