// Блок «Заметки врача» (A2): полный список комментариев врача к разборам,
// новые сверху. На дашборде виден только последний — здесь все.
// Нет заметок — блок не рисуем: тихое отсутствие вместо пустой секции.
import { useEffect, useState } from 'react'
import * as api from '../../api'
import type { DoctorNoteItem, RiskLevel } from '../../types'

const riskBadge: Record<RiskLevel, string> = {
  green: 'badge-green',
  yellow: 'badge-gold',
  red: 'badge-red',
}
const riskLabels: Record<RiskLevel, string> = {
  green: 'Норма',
  yellow: 'Внимание',
  red: 'Тревога',
}

export default function DoctorNotesBlock() {
  const [notes, setNotes] = useState<DoctorNoteItem[] | null>(null)

  useEffect(() => {
    api.fetchMyNotes().then((d) => setNotes(d.items)).catch(() => setNotes([]))
  }, [])

  if (!notes || notes.length === 0) return null

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-medium text-ink">Заметки врача</h2>
        <span className="text-[11.5px] text-ink-soft">· {notes.length}</span>
      </div>
      <div className="flex flex-col gap-2">
        {notes.map((n) => (
          <div key={n.id} className="flip-card flip-card--gold">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] text-ink-soft tabular-nums">
                {n.doctor_name || 'Врач'} · {n.created_at.slice(0, 16).replace('T', ' ')}
              </span>
              <span className={`badge ${riskBadge[n.risk_level]}`}>
                разбор: {riskLabels[n.risk_level]}
              </span>
            </div>
            <p className="text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap mt-2">{n.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
