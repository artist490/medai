// Карточка приёма: статус, жалобы, заключение врача, отмена (F008)
import { useState } from 'react'
import * as api from '../../api'
import AvatarDoctor from '../../components/AvatarDoctor'
import type { Visit } from '../../types'
import { STATUS_INFO, fmtDate } from './shared'

export default function VisitCard({ visit, onChanged }: { visit: Visit; onChanged: (visit: Visit) => void }) {
  const [busy, setBusy] = useState(false)
  const info = STATUS_INFO[visit.status]

  async function cancel() {
    setBusy(true)
    try {
      onChanged(await api.cancelVisit(visit.id))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`flip-card ${visit.status === 'cancelled' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`badge ${info.cls} normal-case tracking-normal`}>{info.label}</span>
        <span className="text-xs font-extrabold text-teal-dark/60">
          {visit.visit_date ? `на ${fmtDate(visit.visit_date)} · ` : ''}запись от {fmtDate(visit.created_at)}
        </span>
      </div>
      {visit.reason && <div className="text-sm font-extrabold text-teal-dark mt-1.5">{visit.reason}</div>}
      <p className="text-sm text-teal-dark/90 mt-1 whitespace-pre-wrap">{visit.complaints}</p>

      {visit.status === 'completed' && visit.conclusion && (
        <div className="mt-2 border-t border-[#e5e7eb] pt-2 flex flex-col gap-1">
          <div className="text-xs font-semibold text-teal-dark/50 flex items-center gap-1.5">
            {visit.doctor_name ? (
              <AvatarDoctor size={20} />
            ) : null}
            Заключение врача{visit.doctor_name ? ` · ${visit.doctor_name}` : ''}
          </div>
          <p className="text-sm text-teal-dark/90 whitespace-pre-wrap">{visit.conclusion}</p>
          {visit.recommendations && (
            <p className="text-sm text-teal-dark/75 whitespace-pre-wrap">
              <span className="font-extrabold">Рекомендации: </span>{visit.recommendations}
            </p>
          )}
        </div>
      )}

      {visit.status === 'planned' && (
        <div className="mt-2">
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={cancel}>
            Отменить запись
          </button>
        </div>
      )}
    </div>
  )
}
