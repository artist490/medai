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
import OcrText from '../components/OcrText'
import { CardFormFields, CardView, defaultCardForm } from '../components/CardAnamnesis'
import type { CardFormState } from '../components/CardAnamnesis'
import RiskSystems from '../components/RiskSystems'
import PageHeader from '../components/PageHeader'
import { Skeleton, SkeletonCard, SkeletonRows } from '../components/Skeleton'
import { categoryLabel } from './medcard/shared'
import type { DocumentItem, Measurement, MedCard, OcrResult, User, DoctorNote, Visit, VisitStatus } from '../types'

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

type Tab = 'measurements' | 'medcard' | 'visits' | 'documents'

const TABS: Array<{ key: Tab; label: string; icon: 'stethoscope' | 'care' | 'calendar' | 'doc' }> = [
  { key: 'measurements', label: 'Замеры', icon: 'stethoscope' },
  { key: 'medcard', label: 'Медкарта', icon: 'care' },
  { key: 'visits', label: 'Приёмы', icon: 'calendar' },
  { key: 'documents', label: 'Документы', icon: 'doc' },
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
      {error && <div className="text-[12.5px] text-coral-dark">{error}</div>}
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
      <section className="panel">
        <h2 className="text-[14px] font-medium text-ink mb-1">Замеры <span className="text-ink-soft font-normal">· {items.length}</span></h2>
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
                <tr key={m.id} className={m.id === selectedId ? 'bg-[#f4f8f6]' : ''}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className={`row-avatar row-avatar--${m.analysis?.risk_level ?? 'green'}`}>
                        {m.recorded_at.slice(8, 10)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium tabular-nums">{shortDate(m.recorded_at)}</div>
                        <div className="text-[12px] text-ink-soft truncate max-w-[420px]"><Summary m={m} /></div>
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
                      className="text-[12.5px] text-teal-dark hover:underline underline-offset-2 whitespace-nowrap"
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
              <h2 className="text-[14px] font-medium text-ink">Разбор замера</h2>
              <RiskBadge level={a.risk_level} />
              {a.risk_level === 'red' && !a.doctor_seen_at && (
                <button className="btn btn-ghost btn-sm"
                        onClick={() => onMarkSeen(a.id)}>
                  Отметить разобранным
                </button>
              )}
            </div>

            <span className="text-[11.5px] text-ink-soft tabular-nums">анализ от {a.created_at.slice(0, 16)}</span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {a.findings.map((f) => <IndicatorCard key={f.key} finding={f} />)}
          </div>

          <div className="panel">
            <h3 className="text-[14px] font-medium text-ink">
              Комментарии врача {a.notes && a.notes.length > 0 && <span className="text-ink-soft font-normal">· {a.notes.length}</span>}
            </h3>

            {a.notes && a.notes.length > 0 ? (
              <div className="flex flex-col gap-2">
                {a.notes.map((n) => (
                  <div key={n.id} className="flip-card flip-card--gold">
                    <div className="text-[11.5px] text-ink-soft tabular-nums">
                      {n.doctor_name} · {n.created_at.slice(0, 16)}
                    </div>
                    <p className="text-[13px] leading-relaxed text-ink mt-1.5">{n.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-5">
                <EmptyArt className="mx-auto mb-3 opacity-70" />
                <p className="text-[12.5px] text-ink-soft">
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
      <form onSubmit={save} className="panel flex flex-col gap-4">
        <h2 className="text-[14px] font-medium text-ink">Правка анкеты пациента</h2>
        <CardFormFields form={form} setField={setField} />
        {error && <div className="text-[12.5px] text-coral-dark">{error}</div>}
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
      <div className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-medium text-ink">Сводка к приёму</h2>
          <span className="text-[11.5px] text-ink-soft">формируется языковой моделью, данные обезличены</span>
        </div>
        {summaryBusy && <p className="text-[13px] text-ink-soft mt-3">Готовим сводку по данным пациента…</p>}
        {!summaryBusy && summary && (
          <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap mt-3">{summary}</p>
        )}
        {!summaryBusy && !summary && summaryError && (
          <div className="text-[12.5px] text-coral-dark mt-2">{summaryError}</div>
        )}
        {!summaryBusy && !summary && !summaryError && (
          <p className="text-[13px] text-ink-soft leading-relaxed mt-3">
            Краткая выжимка: анамнез, жалобы, динамика показателей и на что обратить внимание.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-4 no-print">
          <button className="btn btn-gold btn-sm" disabled={summaryBusy} onClick={askSummary}>
            {summary ? 'Обновить сводку' : 'Сгенерировать сводку'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>Печать карточки</button>
        </div>
      </div>

      {/* Анкета */}
      <div className="panel">
        <h2 className="text-[14px] font-medium text-ink mb-3">Анкета-анамнез</h2>
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
    <form onSubmit={submit} className="mt-3 flex flex-col gap-3 bg-[#f7f9f8] rounded-md p-4 border border-line">
      <div className="text-[13px] font-medium text-ink">Принять пациента</div>
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
      {error && <div className="text-[12.5px] text-coral-dark">{error}</div>}
      <button className="btn btn-gold w-fit btn-sm" disabled={busy || !conclusion.trim()}>
        {busy ? 'Сохраняем…' : 'Завершить приём'}
      </button>
    </form>
  )
}

function VisitsTab({ visits, onVisits }: {
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
        <h2 className="text-[14px] font-medium text-ink mb-3">
          Ждут приёма <span className="text-ink-soft font-normal">· {planned.length}</span>
        </h2>
        {planned.length === 0 ? (
          <div className="panel p-6 text-center text-[13px] text-ink-soft">
            Плановых приёмов нет.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {planned.map((v) => (
              <div key={v.id} className="flip-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${STATUS_INFO[v.status].cls}`}>
                    {v.visit_date ? `приём ${fmtDate(v.visit_date)}` : 'дата не указана'}
                  </span>
                  {v.reason && <span className="text-[13px] font-medium text-ink">{v.reason}</span>}
                </div>
                <div className="mt-2.5">
                  <div className="text-[11px] text-ink-soft">Жалобы пациента</div>
                  <p className="text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap mt-1">{v.complaints}</p>
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
        <h2 className="text-[14px] font-medium text-ink mb-3">
          История приёмов <span className="text-ink-soft font-normal">· {history.length}</span>
        </h2>
        {history.length === 0 ? (
          <div className="text-[13px] text-ink-soft">Завершённых и отменённых приёмов пока нет.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((v) => (
              <div key={v.id} className={`flip-card ${v.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`badge ${STATUS_INFO[v.status].cls}`}>{STATUS_INFO[v.status].label}</span>
                  <span className="text-[11.5px] text-ink-soft tabular-nums">
                    {v.visit_date ? `${fmtDate(v.visit_date)} · ` : ''}запись от {fmtDate(v.created_at)}
                  </span>
                </div>
                {v.reason && <div className="text-[13px] font-medium text-ink mt-1.5">{v.reason}</div>}
                <p className="text-[13px] leading-relaxed text-ink-soft mt-1 whitespace-pre-wrap">{v.complaints}</p>
                {v.conclusion && (
                  <div className="mt-3 pt-3 border-t border-line">
                    <div className="text-[11px] text-ink-soft">Заключение</div>
                    <p className="text-[13px] leading-relaxed text-ink whitespace-pre-wrap mt-1">{v.conclusion}</p>
                    {v.recommendations && (
                      <p className="text-[13px] leading-relaxed text-ink-soft whitespace-pre-wrap mt-1.5">
                        <span className="text-ink font-medium">Рекомендации: </span>{v.recommendations}
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

// ---------- Вкладка «Документы» (В2): результаты исследований пациента ----------

function DocumentsDoctorTab({ patientId }: { patientId: string }) {
  const [docs, setDocs] = useState<DocumentItem[] | null>(null)
  const [error, setError] = useState('')
  const [openDoc, setOpenDoc] = useState<{ id: number; ocr: OcrResult } | null>(null)
  const [textBusy, setTextBusy] = useState<number | null>(null)

  function load() {
    setError('')
    setDocs(null)
    api.fetchPatientDocuments(patientId)
      .then((d) => setDocs(d.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить документы'))
  }

  useEffect(() => { load() }, [patientId])

  async function showText(doc: DocumentItem) {
    if (openDoc?.id === doc.id) { setOpenDoc(null); return }
    setTextBusy(doc.id)
    setError('')
    try {
      const ocr = await api.fetchPatientDocumentOcr(patientId, doc.id)
      setOpenDoc({ id: doc.id, ocr })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть текст')
    } finally {
      setTextBusy(null)
    }
  }

  async function download(doc: DocumentItem) {
    const resp = await fetch(`/api/doctor/patients/${patientId}/documents/${doc.id}/download`, {
      credentials: 'same-origin',
    })
    if (!resp.ok) return
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = doc.filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function fmtSize(n: number): string {
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' МБ'
    return Math.max(1, Math.round(n / 1024)) + ' КБ'
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flip-hint">
        Результаты исследований, загруженные пациентом. Открытие текста или скачивание
        фиксируется — пациент видит, что врач открывал документ.
      </div>
      {error && <div className="text-[12.5px] text-coral-dark">{error}</div>}
      {docs === null ? (
        <SkeletonRows rows={3} />
      ) : docs.length === 0 ? (
        <div className="panel py-8 text-center text-[13px] text-ink-soft">
          Пациент ещё не загрузил ни одного документа.
        </div>
      ) : (
        <div className="panel divide-y divide-[#eef4f3]">
          {docs.map((d) => (
            <div key={d.id} className="py-3">
              <div className="flex items-center gap-3">
                <span className="emoji-box"><Icon name="doc" size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-[#1b2622] truncate">{d.title}</div>
                  <div className="text-xs text-ink-soft">
                    {categoryLabel(d.category)} · {fmtSize(d.size)} · {d.uploaded_at.slice(0, 16).replace('T', ' ')}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" disabled={textBusy === d.id}
                        onClick={() => showText(d)}
                        title="Показать распознанный текст">
                  {openDoc?.id === d.id ? 'Свернуть' : 'Текст'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => download(d)}
                        aria-label={'Скачать ' + d.title}>
                  <Icon name="download" size={16} />
                </button>
              </div>
              {openDoc?.id === d.id && (
                <div className="mt-3 pl-[30px]">
                  {openDoc.ocr.status === 'ready' && openDoc.ocr.text ? (
                    <OcrText text={openDoc.ocr.text} raw={openDoc.ocr.text_raw} />
                  ) : (
                    <p className="text-[13px] text-ink-soft">
                      Документ ещё не распознан — пациент может запустить распознавание в медкарте.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
      <div className="panel p-8 text-center">
        <p className="text-[13.5px] text-coral-dark mb-4">{error}</p>
        <Link to="/patients" className="btn btn-ghost">К списку пациентов</Link>
      </div>
    )
  }
  if (!patient) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton w="45%" h={26} r={4} />
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
      <section className="flex flex-wrap items-center gap-x-8 gap-y-4 pb-5 border-b border-line">
        <span className="w-11 h-11 rounded-full grid place-items-center bg-[#edf2f0] text-teal-deep shrink-0">
          <AvatarPatient size={26} />
        </span>
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-[13px]">
          <div>
            <dt className="text-[11px] text-ink-soft">Email</dt>
            <dd className="text-ink mt-0.5">{patient.email}</dd>
          </div>
          {patient.phone && (
            <div>
              <dt className="text-[11px] text-ink-soft">Телефон</dt>
              <dd className="text-ink mt-0.5 tabular-nums">{patient.phone}</dd>
            </div>
          )}
          <div>
            <dt className="text-[11px] text-ink-soft">Возраст</dt>
            <dd className="text-ink mt-0.5 tabular-nums">{patient.age ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-soft">Пол</dt>
            <dd className="text-ink mt-0.5">{sexLabel(patient.sex)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-ink-soft">Рост</dt>
            <dd className="text-ink mt-0.5 tabular-nums">{patient.height_cm ? `${patient.height_cm} см` : '—'}</dd>
          </div>
        </dl>
      </section>

      <div className="flex gap-2 flex-wrap no-print">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`btn btn-sm ${tab === t.key ? 'btn-gold' : 'btn-ghost'}`}
            aria-pressed={tab === t.key}
          >
            <Icon name={t.icon} size={14} />
            {t.label}
            {t.key === 'visits' && plannedCount > 0 && (
              <span className={tab === t.key ? 'text-white/70 tabular-nums' : 'text-ink-soft tabular-nums'}>
                {plannedCount}
              </span>
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
              <Skeleton w="38%" h={20} r={4} />
              <SkeletonCard lines={4} />
              <SkeletonCard lines={3} />
            </div>
          )}
          {!cardLoading && cardError && (
            <div className="flex flex-col items-start gap-3">
              <div className="text-[12.5px] text-coral-dark">{cardError}</div>
              <button className="btn btn-ghost" onClick={loadCard}>Повторить</button>
            </div>
          )}
        </>
      )}
      {tab === 'medcard' && !cardLoading && !cardError && card && (
        <MedcardTab patientId={id!} items={items} card={card} onCardSaved={setCard} />
      )}
      {tab === 'visits' && (
        <VisitsTab visits={visits} onVisits={setVisits} />
      )}
      {tab === 'documents' && <DocumentsDoctorTab patientId={id!} />}
    </div>
  )
}
