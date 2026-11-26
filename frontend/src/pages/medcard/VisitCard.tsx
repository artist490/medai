// Карточка приёма: статус, жалобы, заключение врача, отмена (F008)
import { useState } from 'react'
import * as api from '../../api'
import AvatarDoctor from '../../components/AvatarDoctor'
import type { Visit } from '../../types'
import { STATUS_INFO, fmtDate } from './shared'

export default function VisitCard({ visit, onChanged }: { visit: Visit; onChanged: (visit: Visit) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const info = STATUS_INFO[visit.status]

  async function cancel() {
    if (!window.confirm(`Отменить запись на ${fmtDate(visit.visit_date)}?`)) return
    setBusy(true)
    setError('')
    try {
      onChanged(await api.cancelVisit(visit.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить запись')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flip-card ${visit.status === 'cancelled' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={`badge ${info.cls}`}>{info.label}</span>
        <span className="text-[11.5px] text-ink-soft tabular-nums">
          {visit.visit_date ? `на ${fmtDate(visit.visit_date)} · ` : ''}запись от {fmtDate(visit.created_at)}
        </span>
      </div>
      {error && <div className="text-[12px] text-coral-dark mt-1.5">{error}</div>}
      {visit.reason && <div className="text-[13.5px] font-medium text-ink mt-2">{visit.reason}</div>}
      <p className="text-[13px] leading-relaxed text-ink-soft mt-1 whitespace-pre-wrap">{visit.complaints}</p>

      {visit.status === 'completed' && visit.conclusion && (
        <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1.5">
          <div className="text-[11.5px] text-ink-soft flex items-center gap-1.5">
            {visit.doctor_name ? <AvatarDoctor size={18} /> : null}
            Заключение врача{visit.doctor_name ? ` · ${visit.doctor_name}` : ''}
          </div>
          <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap">{visit.conclusion}</p>
          {visit.recommendations && (
            <p className="text-[13px] leading-relaxed text-ink-soft whitespace-pre-wrap">
              <span className="text-ink font-medium">Рекомендации: </span>{visit.recommendations}
            </p>
          )}
        </div>
      )}

      {visit.status === 'planned' && (
        <div className="mt-3">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>
            Отменить запись
          </button>
        </div>
      )}
    </div>
  )
}
