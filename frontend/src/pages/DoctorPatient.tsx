// Карточка пациента: профиль, замеры с рисками, разбор анализа и комментарии врача.
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../api'
import IndicatorCard from '../components/IndicatorCard'
import { Summary } from '../components/Summary'
import RiskBadge from '../components/RiskBadge'
import { Icon } from '../components/Icon'
import type { Measurement, User, DoctorNote } from '../types'

const riskBadgeClass = {
  green: 'badge-green',
  yellow: 'badge-gold',
  red: 'badge-red',
} as const

const riskLabels = {
  green: 'Норма',
  yellow: 'Внимание',
  red: 'Тревога',
} as const

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function sexLabel(sex: User['sex']): string {
  if (sex === 'male') return 'мужской'
  if (sex === 'female') return 'женский'
  return '—'
}

function NoteForm({ analysisId, onAdded }: { analysisId: number; onAdded: (n: DoctorNote) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    const t = text.trim()
    if (!t) return
    setBusy(true)
    setError('')
    try {
      const note = await api.addDoctorNote(analysisId, t)
      onAdded(note)
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-3">
      <textarea
        className="flip-input min-h-[64px]"
        placeholder="Комментарий пациенту: разбор показателей, что сделать дальше…"
        value={text}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
        aria-label="Комментарий врача"
      />
      {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
      <button className="btn btn-teal w-fit" disabled={busy || !text.trim()} onClick={submit}>
        {busy ? 'Отправляем…' : 'Добавить комментарий'}
      </button>
    </div>
  )
}

export default function DoctorPatient() {
  const { id } = useParams()
  const [patient, setPatient] = useState<User | null>(null)
  const [items, setItems] = useState<Measurement[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.fetchPatient(id!)
      .then((d) => {
        setPatient(d.patient)
        setItems(d.items)
        // По умолчанию раскрываем последний замер с анализом
        const first = d.items.find((m) => m.analysis)
        if (first) setSelectedId(first.id)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [id])

  if (error) {
    return (
      <div className="bg-white rounded-xl p-8 text-center glow-coral">
        <p className="font-bold text-coral-dark mb-4">{error}</p>
        <Link to="/patients" className="btn btn-teal">К списку пациентов</Link>
      </div>
    )
  }
  if (!patient) return <div className="text-center font-extrabold text-teal-dark animate-pulse">Загрузка…</div>

  const selected = items.find((m) => m.id === selectedId) ?? null
  const a = selected?.analysis ?? null

  function onNoteAdded(note: DoctorNote) {
    setItems((prev) => prev.map((m) => (
      m.id === selectedId && m.analysis
        ? { ...m, analysis: { ...m.analysis!, notes: [...(m.analysis.notes ?? []), note] } }
        : m
    )))
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow"><Link to="/patients" className="hover:underline">Пациенты</Link> · карточка</div>
          <h1 className="text-4xl mt-1.5" style={{ fontSize: 36 }}>{patient.name || '(без имени)'}</h1>
        </div>
        <Link to="/patients" className="btn btn-ghost">← К списку</Link>
      </div>

      {/* Профиль */}
      <section className="panel">
        <div className="flex flex-wrap gap-x-10 gap-y-3 text-sm font-bold text-teal-dark/80">
          <span><span className="text-teal-dark/50">Email:</span> {patient.email}</span>
          <span><span className="text-teal-dark/50">Возраст:</span> {patient.age ?? '—'}</span>
          <span><span className="text-teal-dark/50">Пол:</span> {sexLabel(patient.sex)}</span>
          <span><span className="text-teal-dark/50">Рост:</span> {patient.height_cm ? `${patient.height_cm} см` : '—'}</span>
        </div>
      </section>

      {/* Замеры */}
      <section className="bg-white rounded-[20px] p-6" style={{ boxShadow: '0 6px 24px rgba(23,46,42,.06)' }}>
        <h2 className="text-xl mb-2">Замеры <span className="text-teal-dark/40 text-base">· {items.length}</span></h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Замер</th>
                <th>Статус</th>
                <th className="!text-right">Разбор</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={3} className="text-center text-sm text-teal-dark/60 py-8">Замеров пока нет</td></tr>
              )}
              {items.map((m) => (
                <tr key={m.id} className={m.id === selectedId ? 'bg-teal-bg/40' : ''}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className={`row-avatar row-avatar--${m.analysis?.risk_level ?? 'green'}`}>
                        {m.recorded_at.slice(8, 10)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-extrabold">{shortDate(m.recorded_at)}</div>
                        <div className="text-xs text-teal-dark/60 truncate max-w-[420px]"><Summary m={m} /></div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {m.analysis ? (
                      <span className={`${riskBadgeClass[m.analysis.risk_level]} badge`}>
                        {riskLabels[m.analysis.risk_level]}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="!text-right">
                    <button
                      className="font-extrabold text-teal hover:text-teal-light whitespace-nowrap"
                      onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}
                    >
                      {m.id === selectedId ? 'Свернуть' : 'Разобрать'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Разбор выбранного анализа + комментарии */}
      {selected && a && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl">Разбор замера</h2>
              <RiskBadge level={a.risk_level} />
            </div>
            <span className="text-sm text-teal-dark/60 font-bold">анализ от {a.created_at.slice(0, 16)}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {a.findings.map((f) => <IndicatorCard key={f.key} finding={f} />)}
          </div>

          {/* Комментарии врача: список + форма */}
          <div className="bg-white rounded-xl p-5 glow-soft">
            <div className="section-title mb-3">
              <span className="emoji-box"><Icon name="stethoscope" size={20} /></span>
              Комментарии врача {a.notes && a.notes.length > 0 && <span className="text-teal-dark/40">· {a.notes.length}</span>}
            </div>

            {a.notes && a.notes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {a.notes.map((n) => (
                  <div key={n.id} className="flip-card flip-card--gold">
                    <div className="text-xs font-extrabold text-teal-dark/60">
                      {n.doctor_name} · {n.created_at.slice(0, 16)}
                    </div>
                    <p className="text-sm text-teal-dark/90 mt-1">{n.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-teal-dark/55 font-bold">Комментариев пока нет</p>
            )}

            <NoteForm analysisId={a.id} onAdded={onNoteAdded} />
          </div>
        </section>
      )}
    </div>
  )
}
