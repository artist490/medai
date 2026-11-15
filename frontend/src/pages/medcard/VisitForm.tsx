// Форма записи на приём: новая правка и редактирование жалоб (F008)
import { FormEvent, useState } from 'react'
import * as api from '../../api'
import type { Visit } from '../../types'
import { fmtDate } from './shared'

export default function VisitForm({ editing, defaultReason, onDone, onCancel }: {
  editing: Visit | null
  defaultReason?: string
  onDone: (visit: Visit, isEdit: boolean) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(editing?.visit_date ?? '')
  const [reason, setReason] = useState(editing?.reason ?? defaultReason ?? '')
  const [complaints, setComplaints] = useState(editing?.complaints ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!complaints.trim()) return
    setBusy(true)
    setError('')
    try {
      const visit = editing
        ? await api.patchVisit(editing.id, {
            visit_date: date, reason: reason.trim(), complaints: complaints.trim(),
          })
        : await api.createVisit({
            visit_date: date, reason: reason.trim(), complaints: complaints.trim(),
          })
      onDone(visit, !!editing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось записаться')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 bg-teal-bg/40 rounded-xl p-4 border border-[#e5e7eb]">
      <div className="text-sm font-extrabold text-teal-dark">
        {editing ? `Правка приёма от ${fmtDate(editing.created_at)}` : 'Новая запись на приём'}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="flip-label" htmlFor="v-date">Желаемая дата</label>
          <input id="v-date" type="date" className="flip-input" value={date}
                 onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="flip-label" htmlFor="v-reason">Цель визита</label>
          <input id="v-reason" className="flip-input" placeholder="консультация, расшифровка МРТ…"
                 maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="flip-label" htmlFor="v-complaints">Жалобы</label>
        <textarea id="v-complaints" className="flip-input min-h-[64px]" maxLength={2000} required
                  placeholder="что беспокоит, как давно, что принимали — врач прочитает это до визита"
                  value={complaints} onChange={(e) => setComplaints(e.target.value)} />
      </div>
      {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
      <div className="flex gap-2">
        <button className="btn btn-gold btn-sm" disabled={busy || !complaints.trim()}>
          {busy ? 'Отправляем…' : editing ? 'Сохранить правку' : 'Записаться'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Отмена</button>
      </div>
    </form>
  )
}
