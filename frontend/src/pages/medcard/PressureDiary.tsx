// Дневник давления: утро/вечер по дням за неделю (F008)
import type { Measurement } from '../../types'

export default function PressureDiary({ items }: { items: Measurement[] }) {
  const withBP = items.filter((m) => m.systolic != null)
  const days = new Map<string, Measurement[]>()
  for (const m of withBP) {
    const day = m.recorded_at.slice(0, 10)
    days.set(day, [...(days.get(day) ?? []), m])
  }
  const list = [...days.entries()].slice(0, 7)

  if (list.length === 0) {
    return <p className="text-sm text-[#8aa09c] font-semibold mt-2">Замеров давления пока нет</p>
  }
  return (
    <div className="mt-2 divide-y divide-[#eef4f3]">
      {list.map(([day, ms]) => (
        <div key={day} className="py-2.5 grid sm:grid-cols-[110px_1fr] gap-x-4 gap-y-1.5 items-baseline">
          <div className="text-sm font-bold text-[#1b2622]">
            {day.slice(8, 10)}.{day.slice(5, 7)}
          </div>
          <div className="flex flex-col gap-1">
            {ms.map((m) => (
              <div key={m.id} className="flex items-baseline gap-2 text-sm">
                <span className="text-xs font-bold text-[#8aa09c] w-14">
                  {m.period === 'evening' ? 'вечер' : m.period === 'morning' ? 'утро' : ''}
                </span>
                <span className="font-bold text-[#1b2622] tabular-nums">{m.systolic}/{m.diastolic}</span>
                <span className="text-[#8aa09c] text-xs">пульс {m.pulse ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
