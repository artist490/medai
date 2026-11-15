// Медкарта пациента: анкета-анамнез + приёмы (жалобы пациента, заключения врача).
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { brand, clinicCityUrl } from '../brand'
import { Icon } from '../components/Icon'
import AvatarDoctor from '../components/AvatarDoctor'
import { CardCompleteness, CardFormFields, defaultCardForm } from '../components/CardAnamnesis'
import type { CardFormState } from '../components/CardAnamnesis'
import RiskSystems from '../components/RiskSystems'
import AnamnesisSurvey from '../components/AnamnesisSurvey'
import MeasurementsHistory from '../components/MeasurementsHistory'
import { getToken, repeatLastMeasurement, saveGoals, uploadDocument } from '../api'
import type { DocumentItem, Goals } from '../types'
import type { Measurement, MedCard, Visit, VisitStatus } from '../types'

type CardTab = 'overview' | 'anamnesis' | 'meas' | 'docs'

const TABS: Array<{ id: CardTab; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { id: 'overview', label: 'Обзор карты', icon: 'home' },
  { id: 'anamnesis', label: 'Анкета', icon: 'check' },
  { id: 'meas', label: 'Замеры', icon: 'chart' },
  { id: 'docs', label: 'Документы', icon: 'doc' },
]

const STATUS_INFO: Record<VisitStatus, { cls: string; label: string }> = {
  planned: { cls: 'badge-teal', label: 'Запланирован' },
  completed: { cls: 'badge-green', label: 'Завершён' },
  cancelled: { cls: 'badge', label: 'Отменён' },
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

// ---------- Анкета-анамнез ----------

function AnamnesisForm({ card }: { card: MedCard }) {
  const [form, setForm] = useState<CardFormState>(defaultCardForm(card))
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function setField(key: keyof CardFormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await api.updateMedCard(form)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl p-6 glow-soft flex flex-col gap-4">
      <CardCompleteness card={card} />
      <CardFormFields form={form} setField={setField} />

      <div className="flip-hint">
        Эти данные видит врач вашего филиала перед приёмом — так визит пройдёт быстрее.
      </div>

      {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
      {saved && <div className="badge badge-green normal-case tracking-normal w-fit"><Icon name="check" size={12} className="inline-block align-[-1px] mr-1" />Сохранено</div>}

      <button className="btn btn-teal w-fit" disabled={busy}>
        {busy ? 'Сохраняем…' : 'Сохранить анкету'}
      </button>

      {card.updated_by === 'doctor' && card.updated_at && (
        <div className="text-xs font-bold text-teal-dark/50">
          Анкету дополнял врач · {fmtDate(card.updated_at)}
        </div>
      )}
    </form>
  )
}

// ---------- Приёмы ----------

// Выбор способа записи к реальному врачу: сайт клиники, звонок или приложение
function BookingMenu({ reason, onAppBooking, onClose }: {
  reason: string
  onAppBooking: () => void
  onClose: () => void
}) {
  const { user } = useAuth()
  const branch = user?.branch ?? null
  const phone = branch?.phone || brand.phone
  const telHref = `tel:${phone.replace(/[^+\d]/g, '')}`

  return (
    <div className="bg-white rounded-xl p-5 border-2 border-teal glow-soft flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-teal-dark">Записаться: {reason}</div>
          <div className="text-xs font-bold text-teal-dark/55 mt-0.5">
            Выберите удобный способ — запись ведёт к врачу «Спектр-Диагностики»
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрыть"><Icon name="close" size={15} /></button>
      </div>

      <a href={clinicCityUrl(branch?.city)} target="_blank" rel="noopener noreferrer"
         className="flip-card flip-card--ok flex items-center gap-3 hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="care" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Онлайн-запись на сайте клиники</span>
          <span className="block text-xs font-bold text-teal-dark/55">
            {branch ? `${branch.city} · ` : ''}откроется spdmed.ru — выберите врача и время
          </span>
        </span>
        <Icon name="chevron" size={14} className="ml-auto text-teal-dark/40" />
      </a>

      <a href={telHref} className="flip-card flip-card--sky flex items-center gap-3 hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="help" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Позвонить филиалу</span>
          <span className="block text-xs font-bold text-teal-dark/55">{phone}</span>
        </span>
        <Icon name="chevron" size={14} className="ml-auto text-teal-dark/40" />
      </a>

      <button onClick={onAppBooking}
              className="flip-card flex items-center gap-3 text-left hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="clock" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Оставить жалобу в приложении</span>
          <span className="block text-xs font-bold text-teal-dark/55">врач вашего филиала увидит её до приёма</span>
        </span>
        <Icon name="chevron" size={14} className="ml-auto text-teal-dark/40" />
      </button>
    </div>
  )
}

function VisitForm({ editing, defaultReason, onDone, onCancel }: {
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

function VisitCard({ visit, onChanged }: { visit: Visit; onChanged: (visit: Visit) => void }) {
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

// ---------- Страница ----------

export default function MedCard() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as CardTab | null) ?? 'overview'
  function setTab(next: CardTab) {
    const q = new URLSearchParams(params)
    q.set('tab', next)
    setParams(q)
  }
  const [card, setCard] = useState<MedCard | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [items, setItems] = useState<Measurement[]>([])
  const [showVisitForm, setShowVisitForm] = useState(false)
  const [editing, setEditing] = useState<Visit | null>(null)
  const [prefillReason, setPrefillReason] = useState('')
  const [bookMenu, setBookMenu] = useState<string | null>(null) // причина из риск-блока
  const [showSurvey, setShowSurvey] = useState(false)
  const [error, setError] = useState('')
  const [goals, setGoals] = useState<Goals>({ steps: null, sleep: null, water: null, weight: null })
  const [diaryBusy, setDiaryBusy] = useState('')

  useEffect(() => {
    api.fetchMedCard().then(setCard).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
    api.fetchMyVisits().then((d) => setVisits(d.items)).catch(() => {})
    api.listMeasurements(30).then((d) => setItems(d.items)).catch(() => {})
    api.fetchGoals().then(setGoals).catch(() => {})
  }, [])

  if (error && !card) {
    return (
      <div className="bg-white rounded-xl p-8 text-center glow-coral">
        <p className="font-bold text-coral-dark">{error}</p>
      </div>
    )
  }
  if (!card) return <div className="text-center font-extrabold text-teal-dark animate-pulse">Загрузка…</div>

  function onVisitDone(visit: Visit, isEdit: boolean) {
    setVisits((prev) => isEdit ? prev.map((v) => (v.id === visit.id ? visit : v)) : [visit, ...prev])
    setShowVisitForm(false)
    setEditing(null)
    setPrefillReason('')
    setBookMenu(null)
  }

  function startEdit(visit: Visit) {
    setEditing(visit)
    setPrefillReason('')
    setBookMenu(null)
    setShowVisitForm(true)
  }

  // CTA из риск-профиля: предложить способы записи к реальному врачу
  function bookFromRisk(reason: string) {
    setEditing(null)
    setShowVisitForm(false)
    setBookMenu(reason)
    document.getElementById('visits-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function bookInApp() {
    const reason = bookMenu ?? ''
    setBookMenu(null)
    setPrefillReason(reason)
    setShowVisitForm(true)
  }

  // Опросник МЗ завершён: JSON ответов + человекочитаемый список диагнозов
  async function onSurveySaved(surveyJson: string, chronicText: string) {
    try {
      const updated = await api.updateMedCard({
        survey: surveyJson,
        ...(chronicText ? { chronic: chronicText } : {}),
      })
      setCard((prev) => (prev ? { ...prev, survey: updated.survey, chronic: updated.chronic, updated_by: 'patient', updated_at: updated.updated_at } : prev))
      setShowSurvey(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить опросник')
    }
  }

  const plannedCount = visits.filter((v) => v.status === 'planned').length

  return (
    <div className="flex flex-col gap-6">
      <div className="mb-1">
        <div className="eyebrow">Личная медицинская информация</div>
        <h1 className="text-4xl mt-1.5" style={{ fontSize: 32, letterSpacing: '-0.5px' }}>
          Медкарта <Icon name="care" size={26} className="inline-block align-[-4px]" />
        </h1>
      </div>

      <div className="flex gap-2 flex-wrap">
        <button className="btn btn-ghost btn-sm ml-auto" onClick={() => window.print()}>
          Печать карты
        </button>
      </div>
      <div className="flex gap-2 flex-wrap -mt-2">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`btn btn-sm btn-pill ${tab === tb.id ? 'btn-gold' : 'btn-ghost'}`}
          >
            <Icon name={tb.icon} size={14} /> {tb.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
      <RiskSystems items={items} survey={card.survey} onBook={bookFromRisk} />

      <section id="visits-section">
        <div className="section-title mb-3 flex items-center gap-2">
          <span className="emoji-box"><Icon name="clock" size={20} /></span>
          <span>Приёмы</span>
          {plannedCount > 0 && <span className="text-xs font-semibold text-teal-dark/50">· {plannedCount} запланировано</span>}
        </div>

        <div className="flex flex-col gap-3">
          {bookMenu !== null && (
            <BookingMenu
              reason={bookMenu}
              onAppBooking={bookInApp}
              onClose={() => setBookMenu(null)}
            />
          )}

          {showVisitForm ? (
            <VisitForm
              key={prefillReason || (editing ? `edit-${editing.id}` : 'new')}
              editing={editing}
              defaultReason={prefillReason}
              onDone={onVisitDone}
              onCancel={() => { setShowVisitForm(false); setEditing(null); setPrefillReason('') }}
            />
          ) : (
            <div className="flex gap-2">
              <button className="btn btn-gold w-fit" onClick={() => { setEditing(null); setShowVisitForm(true) }}>
                + Записаться на приём
              </button>
            </div>
          )}

          {visits.length === 0 && !showVisitForm && (
            <div className="bg-white rounded-xl p-6 text-center text-sm font-bold text-teal-dark/55 glow-soft">
              Приёмов пока нет. Запишитесь и опишите жалобы — врач подготовится заранее.
            </div>
          )}

          {visits.map((visit) => (
            <div key={visit.id}>
              <VisitCard visit={visit} onChanged={(v) => setVisits((prev) => prev.map((x) => (x.id === v.id ? v : x)))} />
              {visit.status === 'planned' && !showVisitForm && (
                <button
                  className="text-xs font-extrabold text-teal hover:text-teal-light mt-1 ml-1"
                  onClick={() => startEdit(visit)}
                >
                  Изменить жалобу или дату
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
        </>
      )}

      {tab === 'anamnesis' && (
        <section>
          <div className="section-title mb-3">
            <span className="emoji-box"><Icon name="check" size={20} /></span>
            Анкета-анамнез
          </div>
          {showSurvey ? (
            <AnamnesisSurvey
              initial={card.survey}
              onSaved={onSurveySaved}
              onCancel={() => setShowSurvey(false)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <button className="flip-card flip-card--sky flex items-center gap-3 text-left hover:opacity-90 transition-quick"
                      onClick={() => setShowSurvey(true)}>
                <span className="emoji-box"><Icon name="check" size={20} /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-extrabold text-teal-dark">
                    {card.survey ? 'Пройти опросник Минздрава заново' : 'Пройти опросник Минздрава (5 минут)'}
                  </span>
                  <span className="block text-xs font-bold text-teal-dark/55">
                    28 вопросов как на диспансеризации: диагнозы, симптомы, привычки — заполняет форму автоматически
                  </span>
                </span>
                <Icon name="chevron" size={14} className="ml-auto text-teal-dark/40" />
              </button>
              <AnamnesisForm card={card} />
            </div>
          )}
        </section>
      )}

      {tab === 'meas' && (
        <>
          {/* Дневник давления: утро/вечер за неделю */}
          <section className="panel">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <h2 className="text-lg">Дневник давления</h2>
              <div className="flex gap-2">
                {(['morning', 'evening'] as const).map((pt) => (
                  <button key={pt} className="btn btn-ghost btn-sm" disabled={diaryBusy !== ''}
                          onClick={async () => {
                            setDiaryBusy(pt)
                            try {
                              const m = await repeatLastMeasurement(pt)
                              setItems((prev) => [m, ...prev])
                            } finally { setDiaryBusy('') }
                          }}>
                    {pt === 'morning' ? 'Повторить как утренний' : 'Повторить как вечерний'}
                  </button>
                ))}
              </div>
            </div>
            <PressureDiary items={items} />
          </section>

          {/* Мои цели */}
          <section className="panel">
            <GoalsEditor goals={goals} onSaved={setGoals} />
          </section>

          <MeasurementsHistory />
        </>
      )}

      {tab === 'docs' && <DocumentsTab />}

      {tab === 'overview' && (
        <>
          <RiskSystems items={items} survey={card.survey} onBook={bookFromRisk} />
        </>
      )}
    </div>
  )
}

// ---------- Дневник давления: утро/вечер по дням ----------

function PressureDiary({ items }: { items: Measurement[] }) {
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

// ---------- Мои цели: редактор ----------

function GoalsEditor({ goals, onSaved }: {
  goals: Goals
  onSaved: (g: Goals) => void
}) {
  const [form, setForm] = useState({
    steps: goals.steps?.toString() ?? '',
    sleep: goals.sleep?.toString() ?? '',
    water: goals.water?.toString() ?? '',
    weight: goals.weight?.toString() ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  function field(label: string, key: 'steps' | 'sleep' | 'water' | 'weight', unit: string) {
    return (
      <div>
        <label className="flip-label" htmlFor={'goal-' + key}>{label}</label>
        <input
          id={'goal-' + key}
          type="number"
          className="flip-input"
          value={form[key]}
          onChange={(e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setSaved(false) }}
        />
        <div className="flip-hint">{unit}</div>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const savedGoals = await saveGoals({
        steps: form.steps ? Number(form.steps) : null,
        sleep: form.sleep ? Number(form.sleep) : null,
        water: form.water ? Number(form.water) : null,
        weight: form.weight ? Number(form.weight) : null,
      })
      onSaved(savedGoals)
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {field('Шаги в день', 'steps', 'шагов, например 8000')}
        {field('Сон', 'sleep', 'часов, например 8')}
        {field('Вода', 'water', 'мл в день, например 2000')}
        {field('Целевой вес', 'weight', 'кг')}
      </div>
      {saved && (
        <div className="badge badge-green normal-case tracking-normal w-fit">Сохранено</div>
      )}
      <button className="btn btn-teal w-fit" disabled={busy}>
        {busy ? 'Сохраняем…' : 'Сохранить цели'}
      </button>
    </form>
  )
}

// ---------- Документы: загрузка, список, скачивание ----------

function DocumentsTab() {
  const [docs, setDocs] = useState<DocumentItem[] | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    api.fetchDocuments().then((d) => setDocs(d.items)).catch(() => setDocs([]))
  }, [])

  async function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const doc = await uploadDocument(file, title)
      setDocs((prev) => prev ? [doc, ...prev] : [doc])
      setTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить')
    } finally {
      setBusy(false)
    }
  }

  async function download(doc: DocumentItem) {
    const resp = await fetch('/api/documents/' + doc.id + '/download', {
      headers: { Authorization: 'Bearer ' + getToken() },
    })
    if (!resp.ok) return
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = doc.filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function remove(doc: DocumentItem) {
    if (!window.confirm('Удалить «' + doc.title + '»?')) return
    await api.deleteDocument(doc.id).catch(() => {})
    setDocs((prev) => prev ? prev.filter((d) => d.id !== doc.id) : prev)
  }

  function fmtSize(n: number): string {
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' МБ'
    return Math.max(1, Math.round(n / 1024)) + ' КБ'
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => { e.preventDefault(); upload() }}
            className="bg-white rounded-xl p-5 border border-[#e4ebe9] flex flex-col gap-3">
        <div className="text-sm font-bold text-[#1b2622]">Загрузить результат исследования</div>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="flip-input !py-2"
          ref={(el) => { fileRef.current = el }}
        />
        <input
          type="text"
          className="flip-input"
          placeholder="Название: МРТ головы, анализы крови…"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
        <button className="btn btn-teal w-fit" disabled={busy}>
          {busy ? 'Загружаем…' : 'Загрузить документ'}
        </button>
        <div className="flip-hint">PDF или фото до 8 МБ. Документы видны только вам.</div>
      </form>

      {docs === null ? (
        <div className="text-center font-bold text-teal-dark animate-pulse">Загрузка…</div>
      ) : docs.length === 0 ? (
        <p className="text-sm text-[#8aa09c] font-semibold">Документов пока нет</p>
      ) : (
        <div className="divide-y divide-[#eef4f3]">
          {docs.map((d) => (
            <div key={d.id} className="py-3 flex items-center gap-3">
              <span className="emoji-box"><Icon name="doc" size={18} /></span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#1b2622] truncate">{d.title}</div>
                <div className="text-xs text-[#8aa09c]">
                  {fmtSize(d.size)} · {d.uploaded_at.slice(0, 16).replace('T', ' ')}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm ml-auto" onClick={() => download(d)} aria-label={'Скачать ' + d.title}>
                <Icon name="download" size={16} />
              </button>
              <button className="btn btn-ghost btn-sm text-coral" onClick={() => remove(d)} aria-label={'Удалить ' + d.title}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
