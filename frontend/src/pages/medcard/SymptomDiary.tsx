// Дневник самочувствия (Е2): пациент отмечает состояние 1–5 и описание.
// Не путать с жалобами приёма — это регулярный дневник между приёмами.
import { FormEvent, useEffect, useState } from 'react'
import * as api from '../../api'
import type { SymptomNote } from '../../types'

// Самочувствие 1–5: слова вместо абстрактной шкалы
const WELLBEING_LABELS = ['Очень плохо', 'Плохо', 'Средне', 'Хорошо', 'Отлично']

function todayISO(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export default function SymptomDiary() {
  const [notes, setNotes] = useState<SymptomNote[] | null>(null)
  const [wellbeing, setWellbeing] = useState(4)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function load() {
    api.fetchSymptomNotes().then((d) => setNotes(d.items)).catch(() => setNotes([]))
  }

  useEffect(() => { load() }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      const note = await api.addSymptomNote({ recorded_at: todayISO(), wellbeing, text: text.trim() })
      setNotes((prev) => prev ? [note, ...prev] : [note])
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  async function remove(note: SymptomNote) {
    if (!window.confirm('Удалить запись?')) return
    await api.deleteSymptomNote(note.id).catch(() => {})
    setNotes((prev) => prev ? prev.filter((n) => n.id !== note.id) : prev)
  }

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h2 className="text-[14px] font-medium text-ink">Дневник самочувствия</h2>
        {notes && notes.length > 0 && <span className="text-[11.5px] text-ink-soft">· {notes.length}</span>}
      </div>
      <p className="text-[12px] text-ink-soft mb-4">
        Короткие записи о состоянии между приёмами — врач увидит их в вашей карточке.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <span className="flip-label">Самочувствие сегодня</span>
          <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Самочувствие">
            {WELLBEING_LABELS.map((label, i) => {
              const value = i + 1
              const on = wellbeing === value
              return (
                <button key={value} type="button" role="radio" aria-checked={on}
                        onClick={() => setWellbeing(value)}
                        className={`rounded border py-2 text-[11.5px] transition-quick ${
                          on ? 'border-teal-dark bg-[#f4f8f6] text-ink font-medium'
                             : 'border-line text-ink-soft hover:border-[#c4ccc8]'
                        }`}>
                  {value} · {label.split(' ')[0]}
                </button>
              )
            })}
          </div>
        </div>
        <textarea
          className="flip-input min-h-[56px]"
          placeholder="Как вы себя чувствуете? Что беспокоит, что изменилось…"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Описание состояния"
        />
        {error && <div className="text-[12.5px] text-coral-dark">{error}</div>}
        <button className="btn btn-gold w-fit" disabled={busy || !text.trim()}>
          {busy ? 'Сохраняем…' : 'Добавить запись'}
        </button>
      </form>

      {notes && notes.length > 0 && (
        <div className="flex flex-col gap-2 mt-5">
          {notes.map((n) => (
            <div key={n.id} className="flip-card flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-soft tabular-nums">
                  <span>{n.recorded_at.slice(0, 16).replace('T', ' ')}</span>
                  <span className="badge badge-teal">{WELLBEING_LABELS[n.wellbeing - 1]}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap mt-1.5">{n.text}</p>
              </div>
              <button className="btn btn-ghost btn-sm text-coral" onClick={() => remove(n)}
                      aria-label="Удалить запись">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="1.7" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
