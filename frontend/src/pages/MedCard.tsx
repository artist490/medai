// Медкарта пациента: анкета-анамнез + приёмы (жалобы пациента, заключения врача).
// Компоненты вкладок разнесены по pages/medcard/* (см. TECH_DEBT_AUDIT.md F008).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as api from '../api'
import { Icon } from '../components/Icon'
import EmptyArt from '../components/EmptyArt'
import RiskSystems from '../components/RiskSystems'
import AnamnesisSurvey from '../components/AnamnesisSurvey'
import MeasurementsHistory from '../components/MeasurementsHistory'
import { repeatLastMeasurement } from '../api'
import type { Goals, Measurement, MedCard, Visit } from '../types'
import PageHeader from '../components/PageHeader'
import FlowTabs from '../components/FlowTabs'
import { Skeleton, SkeletonCard } from '../components/Skeleton'
import AnamnesisForm from './medcard/AnamnesisForm'
import BookingMenu from './medcard/BookingMenu'
import DocumentsTab from './medcard/DocumentsTab'
import GoalsEditor from './medcard/GoalsEditor'
import PressureDiary from './medcard/PressureDiary'
import VisitCard from './medcard/VisitCard'
import VisitForm from './medcard/VisitForm'
import { TABS } from './medcard/shared'
import type { CardTab } from './medcard/shared'

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
  const [goalsLoaded, setGoalsLoaded] = useState(false)
  const [goalsError, setGoalsError] = useState('')
  const [diaryBusy, setDiaryBusy] = useState('')
  const [diaryMsg, setDiaryMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Цели грузятся асинхронно: «Сохранить» активна только после успешной загрузки —
  // иначе пустая форма молча перезапишет цели на сервере. При сбое — ошибка и «Повторить».
  function loadGoals() {
    setGoalsError('')
    setGoalsLoaded(false)
    api.fetchGoals()
      .then(setGoals)
      .then(() => setGoalsLoaded(true))
      .catch(() => setGoalsError('Не удалось загрузить цели'))
  }

  useEffect(() => {
    api.fetchMedCard().then(setCard).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
    api.fetchMyVisits().then((d) => setVisits(d.items)).catch(() => {})
    api.listMeasurements(30).then((d) => setItems(d.items)).catch(() => {})
    loadGoals()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error && !card) {
    return (
      <div className="bg-white rounded-lg p-8 text-center glow-coral">
        <p className="font-bold text-coral-dark">{error}</p>
      </div>
    )
  }
  if (!card) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton w="42%" h={30} r={10} />
        <div className="flex gap-2">
          {TABS.map((tb) => <Skeleton key={tb.id} w={112} h={32} r={999} />)}
        </div>
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    )
  }

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
      <PageHeader
        title={<>Медкарта <Icon name="care" size={26} className="inline-block align-[-4px]" /></>}
        actions={<button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Печать карты</button>}
      />
      {/* Вкладки с перетекающей активной пилюлей */}
      <FlowTabs
        ariaLabel="Разделы медкарты"
        items={TABS.map((tb) => ({ id: tb.id, label: tb.label, icon: <Icon name={tb.icon} size={14} /> }))}
        value={tab}
        onChange={setTab}
      />

      {/* Содержимое вкладки: пересоздаётся при смене — секции входят каскадом */}
      <div key={tab} className="tab-enter stagger flex flex-col gap-6">
        {tab === 'overview' && (
          <>
            <RiskSystems items={items} survey={card.survey} alarmKeys={card.alarm_keys} onBook={bookFromRisk} />

            <section id="visits-section">
              <div className="section-title mb-3 flex items-center gap-2">
                <span className="emoji-box"><Icon name="calendar" size={20} /></span>
                <span>Приёмы</span>
                {plannedCount > 0 && <span className="text-xs font-semibold text-ink-soft">· {plannedCount} запланировано</span>}
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
                      Записаться на приём
                    </button>
                  </div>
                )}

                {visits.length === 0 && !showVisitForm && (
                  <div className="bg-white rounded-lg p-6 text-center glow-soft">
                    <EmptyArt className="mx-auto mb-2" />
                    <p className="text-base font-bold text-[#1b2622]">Приёмов пока нет</p>
                    <p className="text-sm text-ink-soft mt-1">
                      Запишитесь и опишите жалобы — врач подготовится заранее.
                    </p>
                  </div>
                )}

                {visits.map((visit) => (
                  <div key={visit.id}>
                    <VisitCard visit={visit} onChanged={(v) => setVisits((prev) => prev.map((x) => (x.id === v.id ? v : x)))} />
                    {visit.status === 'planned' && !showVisitForm && (
                      <button
                        className="text-xs font-extrabold text-teal-dark hover:text-teal-deep mt-1 ml-1 min-h-[32px] inline-flex items-center"
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
                alarmKeys={card.alarm_keys}
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
                    <span className="block text-xs font-bold text-ink-soft">
                      28 вопросов как на диспансеризации: диагнозы, симптомы, привычки — заполняет форму автоматически
                    </span>
                  </span>
                  <Icon name="chevron" size={14} className="ml-auto text-teal-deep" />
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
                              setDiaryMsg(null)
                              try {
                                const m = await repeatLastMeasurement(pt)
                                setItems((prev) => [m, ...prev])
                                setDiaryMsg({ kind: 'ok', text: 'Замер добавлен' })
                              } catch (err) {
                                setDiaryMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось добавить замер' })
                              } finally {
                                setDiaryBusy('')
                              }
                            }}>
                      {diaryBusy === pt ? 'Добавляем…' : (pt === 'morning' ? 'Повторить как утренний' : 'Повторить как вечерний')}
                    </button>
                  ))}
                </div>
              </div>
              {diaryMsg && (
                <div className={`badge ${diaryMsg.kind === 'ok' ? 'badge-green' : 'badge-red'} normal-case tracking-normal w-fit mb-3`}>
                  {diaryMsg.text}
                </div>
              )}
              <PressureDiary items={items} />
            </section>

            {/* Мои цели */}
            <section className="panel">
              <GoalsEditor goals={goals} onSaved={setGoals} loaded={goalsLoaded} />
              {goalsError && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <div className="badge badge-red normal-case tracking-normal">{goalsError}</div>
                  <button className="btn btn-ghost btn-sm" onClick={loadGoals}>Повторить</button>
                </div>
              )}
            </section>

            <MeasurementsHistory />
          </>
        )}

        {tab === 'docs' && <DocumentsTab />}
      </div>
    </div>
  )
}
