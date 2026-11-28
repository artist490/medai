// Направления врача (Е3): чеклист «сдать анализ X» в медкарте пациента.
// Выполнил — загрузил бланк в Документы и отметил выполненным.
import { useEffect, useState } from 'react'
import * as api from '../../api'
import { categoryLabel } from './shared'
import type { DoctorOrder } from '../../types'

export default function OrdersBlock() {
  const [orders, setOrders] = useState<DoctorOrder[] | null>(null)

  useEffect(() => {
    api.fetchMyOrders().then((d) => setOrders(d.items)).catch(() => setOrders([]))
  }, [])

  if (!orders) return null

  const planned = orders.filter((o) => o.status === 'planned')
  const history = orders.filter((o) => o.status !== 'planned')
  if (orders.length === 0) return null  // направлений нет — тихо

  async function complete(order: DoctorOrder) {
    const done = await api.completeOrder(order.id).catch(() => null)
    if (done) setOrders((prev) => prev?.map((o) => (o.id === done.id ? done : o)) ?? prev)
  }

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-medium text-ink">Направления врача</h2>
        {planned.length > 0 && (
          <span className="text-[11.5px] text-ink-soft">· {planned.length} к сдаче</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {planned.map((o) => (
          <div key={o.id} className="flip-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-ink">{o.title}</div>
                <div className="text-[11.5px] text-ink-soft mt-0.5">
                  {o.doctor_name || 'Врач'} · запись от {o.created_at.slice(0, 10)}
                  {o.category && o.category !== 'other' && (
                    <> · нужна категория «{categoryLabel(o.category)}» в Документах</>
                  )}
                </div>
              </div>
              <button className="btn btn-teal btn-sm" onClick={() => complete(o)}>
                Отметить выполненным
              </button>
            </div>
          </div>
        ))}
        {history.map((o) => (
          <div key={o.id} className={`flip-card ${o.status === 'cancelled' ? 'opacity-60' : ''}`}>
            <div className="text-[13px] text-ink-soft">
              <span className="text-ink font-medium">{o.title}</span>
              {' — '}{o.status === 'done' ? 'выполнено' : 'отменено врачом'}
              {o.completed_at && <> · {o.completed_at.slice(0, 10)}</>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
