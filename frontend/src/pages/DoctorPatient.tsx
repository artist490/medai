// Карточка пациента: вкладки «Замеры», «Медкарта» (анкета + ИИ-сводка + печать)
// и «Приёмы» (жалобы пациента к визиту, заключения врача).
import { FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../api'
import { markSignalSeen } from '../api'
import IndicatorCard from '../components/IndicatorCard'
import { Summary } from '../components/Summary'
import RiskBadge from '../components/RiskBadge'
import { Icon } from '../components/Icon'
import EmptyArt from '../components/EmptyArt'
import AvatarPatient from '../components/AvatarPatient'
import { CardFormFields, CardView, defaultCardForm } from '../components/CardAnamnesis'
import type { CardFormState } from '../components/CardAnamnesis'
import RiskSystems from '../components/RiskSystems'
import PageHeader from '../components/PageHeader'
import { Skeleton, SkeletonCard, SkeletonRows } from '../components/Skeleton'
import type { Measurement, MedCard, User, DoctorNote, Visit, VisitStatus } from '../types'

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

const STATUS_INFO: Record<VisitStatus, { cls: string; label: string }> = {
  planned: { cls: 'badge-teal', label: 'Запланирован' },
  completed: { cls: 'badge-green', label: 'Завершён' },
  cancelled: { cls: 'badge', label: 'Отменён' },
}

type Tab = 'measurements' | 'medcard' | 'visits'

const TABS: Array<{ key: Tab; label: string; icon: 'stethoscope' | 'care' | 'calendar' }> = [
  { key: 'measurements', label: 'Замеры', icon: 'stethoscope' },
  { key: 'medcard', label: 'Медкарта', icon: 'care' },
  { key: 'visits', label: 'Приёмы', icon: 'calendar' },
]

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
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
      <button className="btn btn-gold w-fit" disabled={busy || !text.trim()} onClick={submit}>
        {busy ? 'Отправляем…' : 'Добавить комментарий'}
      </button>
    </div>
  )
}

// ---------- Вкладка «Замеры» (прежнее содержимое карточки) ----------

function MeasurementsTab({ items, selectedId, setSelectedId, onNoteAdded, onMarkSeen }: {
  items: Measurement[]
  selectedId: number | null
  setSelectedId: (id: number | null) => void
  onNoteAdded: (note: DoctorNote) => void
  onMarkSeen: (analysisId: number) => void
}) {
  const selected = items.find((m) => m.id === selectedId) ?? null
  const a = selected?.analysis ?? null

  return (
    <>
      <section className="bg-white rounded-lg p-6 shadow-float">
        <h2 className="text-[18px] mb-2">Замеры <span className="text-ink-soft text-base">· {items.length}</span></h2>
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
                <tr><td colSpan={3} className="text-center text-sm text-ink-soft py-8">Замеров пока нет</td></tr>
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
                        <div className="text-xs text-ink-soft truncate max-w-[420px]"><Summary m={m} /></div>
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

      {selected && a && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[18px]">Разбор замера</h2>
              <RiskBadge level={a.risk_level} />
              {a.risk_level === 'red' && !a.doctor_seen_at && (
                <button className="btn btn-ghost btn-sm"
                        onClick={() => onMarkSeen(a.id)}>
                  Отметить разобранным
                </button>
              )}
            </div>

            <span className="text-sm text-ink-soft font-bold">анализ от {a.created_at.slice(0, 16)}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {a.findings.map((f) => <IndicatorCard key={f.key} finding={f} />)}
          </div>

          <div className="bg-white rounded-xl p-5 glow-soft">
            <div className="section-title mb-3">
              <span className="emoji-box"><Icon name="stethoscope" size={20} /></span>
              Комментарии врача {a.notes && a.notes.length > 0 && <span className="text-ink-soft">· {a.notes.length}</span>}
            </div>

            {a.notes && a.notes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {a.notes.map((n) => (
                  <div key={n.id} className="flip-card flip-card--gold">
                    <div className="text-xs font-extrabold text-ink-soft">
                      {n.doctor_name} · {n.created_at.slice(0, 16)}
                    </div>
                    <p className="text-sm text-ink-soft mt-1">{n.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <EmptyArt className="mx-auto mb-2" />
                <p className="text-sm text-ink-soft font-bold">
                  Комментариев пока нет — ваш комментарий увидит пациент
                </p>
              </div>
            )}

            <NoteForm analysisId={a.id} onAdded={onNoteAdded} />
          </div>
        </section>
      )}
    </>
  )
}

// ---------- Вкладка «Медкарта»: анкета + ИИ-сводка + печать ----------

function MedcardTab({ patientId, items, card, onCardSaved }: {
  patientId: string
  items: Measurement[]
  card: MedCard
  onCardSaved: (card: MedCard) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<CardFormState>(defaultCardForm(card))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // ИИ-сводка
  const [summary, setSummary] = useState('')
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [summaryError, setSummaryError] = useState('')

  function setField(key: keyof CardFormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCardSaved(await api.updatePatientMedCard(patientId, form))
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  async function askSummary() {
    setSummaryBusy(true)
    setSummaryError('')
    setSummary('')
    try {
      setSummary((await api.fetchPatientSummary(patientId)).summary)
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Не удалось получить сводку')
    } finally {
      setSummaryBusy(false)
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} className="bg-white rounded-xl p-6 glow-soft flex flex-col gap-4">
        <div className="section-title">
          <span className="emoji-box"><Icon name="care" size={20} /></span>
          Правка анкеты пациента
        </div>
        <CardFormFields form={form} setField={setField} />
        {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
        <div className="flex gap-2">
          <button className="btn btn-gold" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Отмена</button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Риск-профиль по системам: картина одним взглядом */}
      <RiskSystems items={items} survey={card.survey} alarmKeys={card.alarm_keys} />

      {/* ИИ-сводка */}
      <div className="bg-white rounded-xl p-5 glow-teal">
        <div className="section-title mb-2">
          <span className="emoji-box"><Icon name="sparkle" size={20} /></span>
          ИИ-сводка к приёму
        </div>
        {summaryBusy && <p className="text-sm font-bold text-ink-soft animate-pulse">Готовим сводку по данным пациента…</p>}
        {!summaryBusy && summary && (
          <p className="text-sm text-ink-soft leading-relaxed whitespace-pre-wrap">{summary}</p>
        )}
        {!summaryBusy && !summary && summaryError && (
          <div className="badge badge-gold normal-case tracking-normal w-fit mb-2">{summaryError}</div>
        )}
        {!summaryBusy && !summary && !summaryError && (
          <p className="text-sm text-ink-soft font-bold">
            Краткая выжимка: анамнез, жалобы, динамика показателей и на что обратить внимание.
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-3 no-print">
          <button className="btn btn-gold btn-sm" disabled={summaryBusy} onClick={askSummary}>
            <Icon name="sparkle" size={14} className="inline-block align-[-2px] mr-1" />
            {summary ? 'Обновить сводку' : 'Сгенерировать сводку'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Печать карточки</button>
          <p className="text-xs text-ink-soft w-full">Сводка формируется нейросетью, данные обезличены</p>
        </div>
      </div>

      {/* Анкета */}
      <div className="bg-white rounded-xl p-6 glow-soft">
        <div className="section-title mb-3">
          <span className="emoji-box"><Icon name="profile" size={20} /></span>
          Анкета-анамнез
        </div>
        <CardView card={card} alarmKeys={card.alarm_keys} />
        <div className="mt-4 no-print">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setForm(defaultCardForm(card)); setError(''); setEditing(true) }}
          >
            Редактировать анкету
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Вкладка «Приёмы» ----------

function CloseVisitForm({ visit, onDone }: { visit: Visit; onDone: (visit: Visit) => void }) {
  const [conclusion, setConclusion] = useState('')
  const [recommendations, setRecommendations] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!conclusion.trim()) return
    setBusy(true)
    setError('')
    try {
      onDone(await api.completeVisit(visit.id, conclusion.trim(), recommendations.trim()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить приём')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 bg-teal-bg/40 rounded-xl p-4 border border-[#e5e7eb]">
      <div className="text-sm font-extrabold text-teal-dark">Принять пациента</div>
      <div>
        <label className="flip-label" htmlFor="cl-conclusion">Заключение</label>
        <textarea id="cl-conclusion" className="flip-input min-h-[64px]" maxLength={2000} required
                  placeholder="что увидели, что порекомендовали пациенту"
                  value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
      </div>
      <div>
        <label className="flip-label" htmlFor="cl-recommendations">Рекомендации</label>
        <textarea id="cl-recommendations" className="flip-input min-h-[56px]" maxLength={2000}
                  placeholder="что делать дальше (необязательно)"
                  value={recommendations} onChange={(e) => setRecommendations(e.target.value)} />
      </div>
      {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
      <button className="btn btn-gold w-fit btn-sm" disabled={busy || !conclusion.trim()}>
        {busy ? 'Сохраняем…' : 'Завершить приём'}
      </button>
    </form>
  )
}

function VisitsTab({ patientId, visits, onVisits }: {
  patientId: string
  visits: Visit[]
  onVisits: (visits: Visit[]) => void
}) {
  const [openId, setOpenId] = useState<number | null>(null)

  function onDone(done: Visit) {
    onVisits(visits.map((v) => (v.id === done.id ? done : v)))
    setOpenId(null)
  }

  const planned = visits.filter((v) => v.status === 'planned')
  const history = visits.filter((v) => v.status !== 'planned')

  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="section-title mb-3">
          <span className="emoji-box"><Icon name="bell" size={20} /></span>
          Ждут приёма <span className="text-ink-soft">· {planned.length}</span>
        </div>
        {planned.length === 0 ? (
          <div className="bg-white rounded-xl p-6 text-center text-sm font-bold text-ink-soft glow-soft">
            Плановых приёмов нет.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {planned.map((v) => (
              <div key={v.id} className="bg-white rounded-xl p-5 glow-teal">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${STATUS_INFO[v.status].cls} normal-case tracking-normal`}>
                    {v.visit_date ? `приём ${fmtDate(v.visit_date)}` : 'дата не указана'}
                  </span>
                  {v.reason && <span className="text-sm font-extrabold text-teal-dark">{v.reason}</span>}
                </div>
                <div className="mt-2">
                  <div className="text-[11px] font-semibold text-ink-soft">Жалобы пациента</div>
                  <p className="text-base text-teal-dark whitespace-pre-wrap mt-0.5">{v.complaints}</p>
                </div>
                {openId === v.id ? (
                  <CloseVisitForm visit={v} onDone={onDone} />
                ) : (
                  <button className="btn btn-gold btn-sm mt-3" onClick={() => setOpenId(v.id)}>
                    Принять пациента
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section-title mb-3">
          <span className="emoji-box"><Icon name="check" size={20} /></span>
          История приёмов <span className="text-ink-soft">· {history.length}</span>
        </div>
        {history.length === 0 ? (
          <div className="text-sm font-bold text-ink-soft">Завершённых и отменённых приёмов пока нет.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((v) => (
              <div key={v.id} className={`flip-card ${v.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${STATUS_INFO[v.status].cls} normal-case tracking-normal`}>{STATUS_INFO[v.status].label}</span>
                  <span className="text-xs font-extrabold text-ink-soft">
                    {v.visit_date ? `${fmtDate(v.visit_date)} · ` : ''}запись от {fmtDate(v.created_at)}
                  </span>
                </div>
                {v.reason && <div className="text-sm font-extrabold text-teal-dark mt-1.5">{v.reason}</div>}
                <p className="text-sm text-ink-soft mt-1 whitespace-pre-wrap">{v.complaints}</p>
                {v.conclusion && (
                  <div className="mt-2 border-t border-[#e5e7eb] pt-2">
                    <div className="text-[11px] font-semibold text-ink-soft">Заключение</div>
                    <p className="text-sm text-ink-soft whitespace-pre-wrap mt-0.5">{v.conclusion}</p>
                    {v.recommendations && (
                      <p className="text-sm text-ink-soft whitespace-pre-wrap mt-1">
                        <span className="font-extrabold">Рекомендации: </span>{v.recommendations}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- Страница ----------

export default function DoctorPatient() {
  const { id } = useParams()
  const [patient, setPatient] = useState<User | null>(null)
  const [items, setItems] = useState<Measurement[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('measurements')
  const [card, setCard] = useState<MedCard | null>(null)
  const [cardLoading, setCardLoading] = useState(true)
  const [cardError, setCardError] = useState('')
  const [visits, setVisits] = useState<Visit[]>([])
  const [error, setError] = useState('')

  function loadCard() {
    setCardLoading(true)
    setCardError('')
    api.fetchPatientMedCard(id!)
      .then(setCard)
      .catch((e) => setCardError(e instanceof Error ? e.message : 'Не удалось загрузить медкарту'))
      .finally(() => setCardLoading(false))
  }

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
    loadCard()
    api.fetchPatientVisits(id!).then((d) => setVisits(d.items)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (error) {
    return (
      <div className="bg-white rounded-xl p-8 text-center glow-coral">
        <p className="font-bold text-coral-dark mb-4">{error}</p>
        <Link to="/patients" className="btn btn-gold">К списку пациентов</Link>
      </div>
    )
  }
  if (!patient) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton w="45%" h={30} r={10} />
        <SkeletonCard lines={2} />
        <SkeletonRows rows={4} />
      </div>
    )
  }

  async function markSignal(aid: number) {
    try {
      await markSignalSeen(aid)
      setItems((prev) => prev.map((m) => (
        m.analysis && m.analysis.id === aid
          ? { ...m, analysis: { ...m.analysis, doctor_seen_at: new Date().toISOString() } }
          : m
      )))
    } catch { /* не критично */ }
  }

  const plannedCount = visits.filter((v) => v.status === 'planned').length

  function onNoteAdded(note: DoctorNote) {
    setItems((prev) => prev.map((m) => (
      m.id === selectedId && m.analysis
        ? { ...m, analysis: { ...m.analysis!, notes: [...(m.analysis.notes ?? []), note] } }
        : m
    )))
  }

  return (
    <div className="flex flex-col gap-6 stagger">
      <div className="no-print">
        <PageHeader
          eyebrow={<><Link to="/patients" className="hover:underline">Пациенты</Link> · карточка</>}
          title={patient.name || '(без имени)'}
          actions={<Link to="/patients" className="btn btn-ghost"><Icon name="chevron-left" size={14} /> К списку</Link>}
        />
      </div>

      {/* Профиль: аватар + мета-строка */}
      <section className="panel flex flex-wrap items-center gap-x-8 gap-y-3">
        <AvatarPatient size={48} />
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <span><span className="text-ink-soft font-semibold">Email:</span> <span className="font-bold text-[#1b2622]">{patient.email}</span></span>
          <span><span className="text-ink-soft font-semibold">Возраст:</span> <span className="font-bold text-[#1b2622]">{patient.age ?? '—'}</span></span>
          <span><span className="text-ink-soft font-semibold">Пол:</span> <span className="font-bold text-[#1b2622]">{sexLabel(patient.sex)}</span></span>
          <span><span className="text-ink-soft font-semibold">Рост:</span> <span className="font-bold text-[#1b2622]">{patient.height_cm ? `${patient.height_cm} см` : '—'}</span></span>
        </div>
      </section>

      {/* Вкладки — пилюли, как в медкарте пациента */}
      <div className="flex gap-2 flex-wrap no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`btn btn-sm btn-pill ${tab === t.key ? 'btn-gold' : 'btn-ghost'}`}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.key === 'visits' && plannedCount > 0 && (
              <span className={`font-bold ${tab === t.key ? 'text-white/75' : 'text-ink-soft'}`}>{plannedCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'measurements' && (
        <MeasurementsTab
          items={items}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          onNoteAdded={onNoteAdded}
          onMarkSeen={(aid: number) => markSignal(aid)}
        />
      )}
      {tab === 'medcard' && (cardLoading || cardError || !card) && (
        <>
          {cardLoading && (
            <div className="flex flex-col gap-6" aria-busy>
              <Skeleton w="38%" h={24} r={10} />
              <SkeletonCard lines={4} />
              <SkeletonCard lines={3} />
            </div>
          )}
          {!cardLoading && cardError && (
            <div className="flex flex-col items-start gap-3">
              <div className="badge badge-red normal-case tracking-normal w-fit">{cardError}</div>
              <button className="btn btn-ghost" onClick={loadCard}>Повторить</button>
            </div>
          )}
        </>
      )}
      {tab === 'medcard' && !cardLoading && !cardError && card && (
        <MedcardTab patientId={id!} items={items} card={card} onCardSaved={setCard} />
      )}
      {tab === 'visits' && (
        <VisitsTab patientId={id!} visits={visits} onVisits={setVisits} />
      )}
    </div>
  )
}
