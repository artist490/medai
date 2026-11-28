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
import DoctorNotesBlock from './medcard/DoctorNotesBlock'
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
     
  }, [])

  if (error && !card) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-[13.5px] text-coral-dark">{error}</p>
      </div>
    )
  }
  if (!card) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton w="42%" h={26} r={4} />
        <div className="flex gap-2">
          {TABS.map((tb) => <Skeleton key={tb.id} w={104} h={30} r={6} />)}
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
        eyebrow="История и документы"
        title="Медкарта"
        sub="Риск по системам организма, приёмы у врача, анкета и замеры."
        actions={<button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Печать карты</button>}
      />
      {/* Вкладки с перетекающим индикатором */}
      <FlowTabs
        ariaLabel="Разделы медкарты"
        items={TABS.map((tb) => ({ id: tb.id, label: tb.label, icon: <Icon name={tb.icon} size={14} /> }))}
        value={tab}
        onChange={setTab}
      />

      {/* Содержимое вкладки: пересоздаётся при смене — секции входят каскадом */}
      <div key={tab} className="tab-enter flex flex-col gap-6">
        {tab === 'overview' && (
          <>
            <RiskSystems items={items} survey={card.survey} alarmKeys={card.alarm_keys} onBook={bookFromRisk} />

            <section id="visits-section">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <h2 className="text-[14px] font-medium text-ink">
                  Приёмы
                  {plannedCount > 0 && (
                    <span className="text-ink-soft font-normal"> · {plannedCount} запланировано</span>
                  )}
                </h2>
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
                  <div className="panel py-10 text-center">
                    <EmptyArt className="mx-auto mb-3 opacity-70" />
                    <p className="text-[13.5px] font-medium text-ink">Приёмов пока нет</p>
                    <p className="text-[12.5px] text-ink-soft mt-1.5 max-w-[44ch] mx-auto leading-relaxed">
                      Запишитесь и опишите жалобы — врач подготовится заранее.
                    </p>
                  </div>
                )}

                {visits.map((visit) => (
                  <div key={visit.id}>
                    <VisitCard visit={visit} onChanged={(v) => setVisits((prev) => prev.map((x) => (x.id === v.id ? v : x)))} />
                    {visit.status === 'planned' && !showVisitForm && (
                      <button
                        className="text-[12px] text-teal-dark hover:underline underline-offset-2 mt-1.5 min-h-[32px] inline-flex items-center"
                        onClick={() => startEdit(visit)}
                      >
                        Изменить жалобу или дату
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* Полный список заметок врача по разборам (A2), новые сверху */}
            <DoctorNotesBlock />
          </>
        )}

        {tab === 'anamnesis' && (
          <section>
            <h2 className="text-[14px] font-medium text-ink mb-3">Анкета-анамнез</h2>
            {showSurvey ? (
              <AnamnesisSurvey
                initial={card.survey}
                alarmKeys={card.alarm_keys}
                onSaved={onSurveySaved}
                onCancel={() => setShowSurvey(false)}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <button
                  className="panel flex items-center gap-3 text-left hover:border-[#c4ccc8] transition-quick"
                  onClick={() => setShowSurvey(true)}
                >
                  <Icon name="check" size={18} className="text-teal-dark shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium text-ink">
                      {card.survey ? 'Пройти опросник Минздрава заново' : 'Пройти опросник Минздрава'}
                    </span>
                    <span className="block text-[12px] text-ink-soft mt-0.5 leading-relaxed">
                      28 вопросов как на диспансеризации — диагнозы, симптомы, привычки. Занимает около 5 минут.
                    </span>
                  </span>
                  <Icon name="chevron" size={14} className="ml-auto text-ink-soft shrink-0" />
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
                <h2 className="text-[14px] font-medium text-ink">Дневник давления</h2>
                <div className="flex flex-wrap gap-2">
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
                      {diaryBusy === pt ? 'Добавляем…' : (pt === 'morning' ? 'Повторить утренний' : 'Повторить вечерний')}
                    </button>
                  ))}
                </div>
              </div>
              {diaryMsg && (
                <div className={`text-[12.5px] mb-3 ${diaryMsg.kind === 'ok' ? 'text-[#146c43]' : 'text-coral-dark'}`}>
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
                  <div className="text-[12.5px] text-coral-dark">{goalsError}</div>
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
