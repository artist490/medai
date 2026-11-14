// Медкарта пациента: анкета-анамнез + приёмы (жалобы пациента, заключения врача).
import { FormEvent, useEffect, useState } from 'react'
import * as api from '../api'
import { useAuth } from '../auth'
import { brand, clinicCityUrl } from '../brand'
import { Icon } from '../components/Icon'
import { CardCompleteness, CardFormFields, defaultCardForm } from '../components/CardAnamnesis'
import type { CardFormState } from '../components/CardAnamnesis'
import RiskSystems from '../components/RiskSystems'
import AnamnesisSurvey from '../components/AnamnesisSurvey'
import type { Measurement, MedCard, Visit, VisitStatus } from '../types'

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
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрыть">✕</button>
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
        <span className="ml-auto text-teal-dark/40">→</span>
      </a>

      <a href={telHref} className="flip-card flip-card--sky flex items-center gap-3 hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="help" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Позвонить филиалу</span>
          <span className="block text-xs font-bold text-teal-dark/55">{phone}</span>
        </span>
        <span className="ml-auto text-teal-dark/40">→</span>
      </a>

      <button onClick={onAppBooking}
              className="flip-card flex items-center gap-3 text-left hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="clock" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Оставить жалобу в приложении</span>
          <span className="block text-xs font-bold text-teal-dark/55">врач вашего филиала увидит её до приёма</span>
        </span>
        <span className="ml-auto text-teal-dark/40">→</span>
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
          <div className="text-xs font-extrabold uppercase tracking-[1px] text-teal-dark/50">Заключение врача{visit.doctor_name ? ` · ${visit.doctor_name}` : ''}</div>
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
  const [card, setCard] = useState<MedCard | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [items, setItems] = useState<Measurement[]>([])
  const [showVisitForm, setShowVisitForm] = useState(false)
  const [editing, setEditing] = useState<Visit | null>(null)
  const [prefillReason, setPrefillReason] = useState('')
  const [bookMenu, setBookMenu] = useState<string | null>(null) // причина из риск-блока
  const [showSurvey, setShowSurvey] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.fetchMedCard().then(setCard).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
    api.fetchMyVisits().then((d) => setVisits(d.items)).catch(() => {})
    api.listMeasurements(10).then((d) => setItems(d.items)).catch(() => {})
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

      <RiskSystems items={items} survey={card.survey} onBook={bookFromRisk} />

      <section>
        <div className="section-title mb-3">
          <span className="emoji-box"><Icon name="profile" size={20} /></span>
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
              <span className="ml-auto text-teal-dark/40">→</span>
            </button>
            <AnamnesisForm card={card} />
          </div>
        )}
      </section>

      <section id="visits-section">
        <div className="section-title mb-3 flex items-center gap-2">
          <span className="emoji-box"><Icon name="clock" size={20} /></span>
          <span>Приёмы</span>
          {plannedCount > 0 && <span className="badge badge-teal normal-case tracking-normal">запланировано: {plannedCount}</span>}
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
    </div>
  )
}
