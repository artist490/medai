// Обязательный дисклеймер на каждом результате анализа.
import { brand } from '../brand'

export default function Disclaimer({ urgent = false, phone }: { urgent?: boolean; phone?: string }) {
  return (
    <div
      className={`border rounded-md px-4 py-3 text-[11.5px] leading-relaxed ${
        urgent
          ? 'border-[#e3c9c6] bg-[#fbf6f5] text-coral-dark'
          : 'border-line bg-[#fafbfa] text-ink-soft'
      }`}
    >
      <span className="font-medium">{brand.name} не ставит диагнозы</span> и не заменяет
      консультацию врача. Рекомендации носят информационный характер и касаются образа
      жизни. При тревожных показателях обратитесь к специалисту
      {urgent ? ` или позвоните в клинику: ${phone || brand.phone}` : ''}, при критических — 103.
    </div>
  )
}
