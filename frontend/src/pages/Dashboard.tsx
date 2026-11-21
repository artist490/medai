// Дашборд пациента — композиция направления A «Клинический свет»:
// hero-карточка давления + donut, полоса показателей с хайрлайнами,
// график + комментарий врача, таблица последних замеров.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as api from '../api'
import type { Finding, Measurement, Stats, Visit } from '../types'
import type { Goals, RiskLevel, Status } from '../types'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import EmptyArt from '../components/EmptyArt'
import AvatarDoctor from '../components/AvatarDoctor'
import { Summary } from '../components/Summary'
import PageHeader from '../components/PageHeader'
import { Skeleton, SkeletonCard, SkeletonRows } from '../components/Skeleton'

const riskColors: Record<RiskLevel, string> = {
  green: '#00b8a9',
  yellow: '#facc15',
  red: '#dc2626',
}
const riskLabels: Record<RiskLevel, string> = {
  green: 'Норма',
  yellow: 'Внимание',
  red: 'Тревога',
}
const statusBadgeClass: Record<Status, string> = {
  ok: 'badge-green',
  warn: 'badge-gold',
  alarm: 'badge-red',
}
const statusText: Record<Status, string> = {
  ok: 'норма',
  warn: 'внимание',
  alarm: 'тревога',
}

function findingByKey(findings: Finding[] | undefined, key: string): Finding | undefined {
  return findings?.find((f) => f.key === key)
}

function StatusPill({ status }: { status?: Status }) {
  if (!status) return <span className="badge badge-teal">нет данных</span>
  return <span className={`${statusBadgeClass[status]} badge`}>{statusText[status]}</span>
}

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function humanDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

// Сегмент полосы показателей
function StripSegment(props: {
  icon: IconName
  label: string
  value: string
  unit?: string
  status?: Status
  hint?: string
  goal?: number
  goalUnit?: string
}) {
  const num = Number(props.value.replace(',', '.'))
  const progress = props.goal && !Number.isNaN(num)
    ? Math.min(100, Math.round((num / props.goal) * 100))
    : null
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="stat-label flex items-center gap-2">
          <Icon name={props.icon} size={16} className="opacity-60" />
          {props.label}
        </span>
        <StatusPill status={props.status} />
      </div>
      <div className="stat-value mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="whitespace-nowrap">{props.value}</span>
        {props.unit && <span className="stat-unit text-xs font-bold whitespace-nowrap">{props.unit}</span>}
      </div>
      {progress !== null && (
        <div className="mt-2">
          <div className="h-1.5 rounded-full bg-[#f1f6f5] overflow-hidden">
            <div className="h-full rounded-full bg-teal-dark" style={{ width: progress + '%' }} />
          </div>
          <div className="mt-1 text-[11px] text-ink-soft">
            {progress}% до цели {props.goal} {props.goalUnit ?? ''}
          </div>
        </div>
      )}
      {progress === null && props.hint && <div className="mt-1 text-xs text-ink-soft">{props.hint}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [items, setItems] = useState<Measurement[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [nextVisit, setNextVisit] = useState<Visit | null>(null)
  const [goals, setGoals] = useState<Goals>({ steps: null, sleep: null, water: null, weight: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [repeatBusy, setRepeatBusy] = useState(false)
  const [repeatMsg, setRepeatMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function load() {
    setLoading(true)
    setError('')
    Promise.all([
      api.listMeasurements(10).then((d) => d.items),
      api.fetchStats(),
      api.fetchGoals(),
      // Ближайший запланированный приём — сверху списка
      api.fetchMyVisits().then((d) => d.items),
    ])
      .then(([ms, st, gl, visits]) => {
        setItems(ms)
        setStats(st)
        setGoals(gl)
        setNextVisit(visits.find((v) => v.status === 'planned') ?? null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Напоминание о вечернем замере: после 18:00, если вечернего замера сегодня нет
  const showEveningReminder = useMemo(() => {
    const hour = new Date().getHours()
    if (hour < 18) return false
    const today = new Date().toISOString().slice(0, 10)
    return !items.some((m) => m.period === 'evening' && m.recorded_at.slice(0, 10) === today)
  }, [items])

  async function repeatEvening() {
    setRepeatBusy(true)
    setRepeatMsg(null)
    try {
      const m = await api.repeatLastMeasurement('evening')
      setItems((prev) => [m, ...prev])
      setRepeatMsg({ kind: 'ok', text: 'Замер добавлен' })
    } catch (err) {
      setRepeatMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось добавить замер' })
    } finally {
      setRepeatBusy(false)
    }
  }

  const latest = items[0] ?? null
  const a = latest?.analysis

  // Donut: распределение замеров по уровню риска
  const riskCounts = useMemo(() => {
    const c = { green: 0, yellow: 0, red: 0 }
    items.forEach((m) => {
      if (m.analysis) c[m.analysis.risk_level] += 1
    })
    return c
  }, [items])
  const totalMeasured = riskCounts.green + riskCounts.yellow + riskCounts.red
  const donutData = [
    { name: 'Норма', value: riskCounts.green, color: riskColors.green },
    { name: 'Внимание', value: riskCounts.yellow, color: riskColors.yellow },
    { name: 'Тревога', value: riskCounts.red, color: riskColors.red },
  ].filter((d) => d.value > 0)

  const bpData = useMemo(
    () => (stats?.points ?? [])
      .filter((p) => p.systolic != null)
      .map((p) => ({ t: shortDate(p.recorded_at), systolic: p.systolic, diastolic: p.diastolic })),
    [stats],
  )

  const bpItem = items.find((m) => m.systolic != null)
  const bpFinding = findingByKey(bpItem?.analysis?.findings, 'blood_pressure')
  const pulseItem = items.find((m) => m.pulse != null)
  const pulseFinding = findingByKey(pulseItem?.analysis?.findings, 'pulse')
  const sleepItem = items.find((m) => m.sleep_hours != null)
  const sleepFinding = findingByKey(sleepItem?.analysis?.findings, 'sleep')
  const bmiItem = items.find((m) => m.analysis?.bmi != null)
  const bmiFinding = findingByKey(bmiItem?.analysis?.findings, 'bmi')

  // Последний комментарий врача
  const lastNote = useMemo(() => {
    const all = items.flatMap((m) => (m.analysis?.notes ?? []).map((n) => ({ ...n })))
    all.sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
    return all[0] ?? null
  }, [items])

  return (
    <div className="flex flex-col gap-6 stagger">
      <PageHeader
        title="Обзор здоровья"
        actions={
          <>
            {latest && (
              <Link to={`/result/${latest.id}`} className="btn btn-ghost">
                <Icon name="pulse" size={16} /> Последний замер
              </Link>
            )}
            <Link to="/new" className="btn btn-gold"><Icon name="pressure" size={16} /> Новый замер</Link>
          </>
        }
      />

      {/* Загрузка: скелетон вместо тихого пустого состояния */}
      {loading && (
        <div className="flex flex-col gap-6" aria-busy>
          <Skeleton w="45%" h={30} r={10} />
          <SkeletonCard lines={4} />
          <SkeletonRows rows={4} />
        </div>
      )}

      {/* Сбой загрузки: ошибка с «Повторить» вместо пустого состояния */}
      {!loading && error && (
        <div className="flex flex-col items-start gap-3">
          <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>
          <button className="btn btn-ghost" onClick={load}>Повторить</button>
        </div>
      )}

      {!loading && !error && (
      <>
      {/* Ближайший приём */}
      {nextVisit && (
        <Link to="/medcard" className="flip-card flip-card--sky flex flex-wrap items-center gap-2 hover:opacity-90 transition-quick">
          <span className="badge badge-teal normal-case tracking-normal">Вы записаны</span>
          <span className="text-sm font-extrabold text-teal-dark">
            {nextVisit.visit_date
              ? `приём ${nextVisit.visit_date.slice(8, 10)}.${nextVisit.visit_date.slice(5, 7)}.${nextVisit.visit_date.slice(0, 4)}`
              : 'приём без даты'}
            {nextVisit.reason ? ` · ${nextVisit.reason}` : ''}
          </span>
          <span className="text-xs font-bold text-ink-soft inline-flex items-center gap-1">подробнее в медкарте <Icon name="chevron" size={12} /></span>
        </Link>
      )}

      {latest && a ? (
        <>
          {showEveningReminder && (
            <div className="rounded-lg border border-[#e4ebe9] bg-white px-5 py-3 flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-[#1b2622]">
                Вечерний замер ещё не сделан — добавьте его в дневник
              </span>
              <button className="btn btn-gold btn-sm ml-auto" disabled={repeatBusy} onClick={repeatEvening}>
                {repeatBusy ? 'Добавляем…' : 'Повторить вечерний'}
              </button>
            </div>
          )}
          {/* Подтверждение/ошибка повтора — вне плашки-напоминания: при успехе
              плашка размонтируется (вечерний замер появился), бейдж остаётся виден */}
          {repeatMsg && (
            <div className={`badge ${repeatMsg.kind === 'ok' ? 'badge-green' : 'badge-red'} normal-case tracking-normal w-fit`}>
              {repeatMsg.text}
            </div>
          )}

          {/* Ряд 1: hero давления + donut */}
          <div className="grid lg:grid-cols-[2fr_1fr] gap-4 items-stretch">
            <div className="stat-card stat-card--hero stat-card--hero-gradient flex flex-col justify-between">
              <div className="flex items-start justify-between gap-3">
                <span className="stat-label flex items-center gap-2">
                  <Icon name="pressure" size={16} className="opacity-70" />
                  Давление
                </span>
                <span className={`hero-pill ${bpFinding ? `hero-pill--${bpFinding.status}` : ''}`}>
                  {bpFinding ? statusText[bpFinding.status] : 'нет данных'}
                </span>
              </div>
              <div className="stat-value mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="whitespace-nowrap">{bpItem ? `${bpItem.systolic}/${bpItem.diastolic ?? '—'}` : '—'}</span>
                {bpItem && <span className="stat-unit text-sm font-bold whitespace-nowrap">мм рт. ст.</span>}
              </div>
              {bpFinding && <p className="mt-2 text-sm text-white/85 max-w-md">{bpFinding.message}</p>}
              {bpItem && (
                <div className="mt-4 text-xs text-white/60">
                  Последний замер с давлением: {shortDate(bpItem.recorded_at)}
                </div>
              )}
            </div>

            <section className="panel flex flex-col">
              <h2 className="text-lg mb-3">Структура замеров</h2>
              <div className="chart-box relative flex-1" style={{ minHeight: 190 }}>
                {totalMeasured > 0 ? (
                  <>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={donutData} dataKey="value" innerRadius="72%" outerRadius="94%"
                             startAngle={90} endAngle={-270} paddingAngle={2} stroke="none">
                          {donutData.map((d) => <Cell key={d.name} fill={d.color} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 grid place-items-center pointer-events-none">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-[#1b2622]">{totalMeasured}</div>
                        <div className="text-[10px] font-semibold text-ink-soft">замеров</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full grid place-items-center text-sm text-ink-soft font-bold">Нет данных</div>
                )}
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                {donutData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2.5 text-sm font-semibold text-[#1b2622]">
                    <span className="legend-dot" style={{ background: d.color }} />
                    {d.name}
                    <span className="ml-auto text-ink-soft">
                      {totalMeasured ? Math.round((d.value / totalMeasured) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Ряд 2: полоса показателей с хайрлайнами */}
          <div className="stat-strip">
            <StripSegment
              icon="pulse" label="Пульс"
              value={pulseItem ? String(pulseItem.pulse) : '—'}
              unit={pulseItem ? 'уд/мин' : undefined}
              status={pulseFinding?.status}
              hint={pulseFinding ? 'Норма 60–100' : undefined}
            />
            <StripSegment
              icon="sleep" label="Сон"
              value={sleepItem ? String(sleepItem.sleep_hours) : '—'}
              unit={sleepItem ? 'ч' : undefined}
              status={sleepFinding?.status}
              goal={goals.sleep ?? undefined}
              goalUnit="ч"
              hint={sleepFinding ? 'Норма 7–9' : 'Здесь появится продолжительность сна'}
            />
            <StripSegment
              icon="scale" label="ИМТ"
              value={bmiItem ? String(bmiItem.analysis!.bmi) : '—'}
              unit={bmiItem ? 'кг/м²' : undefined}
              status={bmiFinding?.status}
              hint={bmiFinding ? 'Норма 18.5–24.9' : 'Норма 18.5–24.9, нужен рост в профиле'}
            />
          </div>

          {/* Ряд 3: график + комментарий врача */}
          <div className="grid lg:grid-cols-[2fr_1fr] gap-4 items-stretch">
            <section className="panel">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-lg">Давление в динамике</h2>
                <div className="flex gap-2">
                  <span className="legend-pill"><span className="legend-dot" style={{ background: '#dc2626' }} />Систолическое</span>
                  <span className="legend-pill"><span className="legend-dot" style={{ background: '#00b8a9' }} />Диастолическое</span>
                </div>
              </div>
              <div className="chart-box" style={{ height: 300 }}>
                {bpData.length >= 2 ? (
                  <ResponsiveContainer>
                    <LineChart data={bpData} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
                      <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#1b2622', fontWeight: 600 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#1b2622', fontWeight: 600 }} domain={['auto', 'auto']} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }} />
                      <Line type="monotone" dataKey="systolic" name="Систолическое" stroke="#dc2626" strokeWidth={3} dot={{ r: 4, strokeWidth: 0, fill: '#dc2626' }} />
                      <Line type="monotone" dataKey="diastolic" name="Диастолическое" stroke="#00b8a9" strokeWidth={3} dot={{ r: 4, strokeWidth: 0, fill: '#00b8a9' }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full grid place-items-center text-sm text-ink-soft font-bold">
                    <span className="inline-flex items-center gap-1.5">
                      Нужно минимум 2 замера с давлением <Icon name="chart" size={14} className="inline-block align-[-2px]" />
                    </span>
                  </div>
                )}
              </div>
            </section>

            <section className="panel flex flex-col">
              <h2 className="text-lg">Комментарий врача</h2>
              {lastNote ? (
                <div className="flip-card flip-card--gold mt-3">
                  <div className="text-xs font-bold text-ink-soft flex items-center gap-1.5">
                    <AvatarDoctor size={20} /> {lastNote.doctor_name} · {lastNote.created_at.slice(0, 16)}
                  </div>
                  <p className="text-sm text-[#2c3e3b] mt-1">{lastNote.text}</p>
                </div>
              ) : (
                <p className="text-sm text-ink-soft mt-3 font-semibold">
                  Заметок пока нет — врач оставит их после разбора замеров.
                </p>
              )}
            </section>
          </div>

          {/* Ряд 4: последние замеры */}
          <section className="panel">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-lg">Последние замеры</h2>
              <Link to="/history" className="btn btn-ghost btn-sm">Вся история <Icon name="chevron" size={13} /></Link>
            </div>
            <div className="overflow-x-auto" data-full-bleed>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Замер</th>
                    <th>Статус</th>
                    <th className="!text-right">Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 6).map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className={`row-avatar row-avatar--${m.analysis?.risk_level ?? 'green'}`}>
                            {m.recorded_at.slice(8, 10)}
                          </span>
                          <div className="min-w-0">
                            <div className="font-bold">{humanDate(m.recorded_at)}</div>
                            <div className="text-xs text-ink-soft"><Summary m={m} /></div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {m.analysis && (
                          <span className={`${statusBadgeClass[m.analysis.risk_level === 'green' ? 'ok' : m.analysis.risk_level === 'yellow' ? 'warn' : 'alarm']} badge`}>
                            {riskLabels[m.analysis.risk_level]}
                          </span>
                        )}
                      </td>
                      <td className="!text-right">
                        <span className="text-sm text-ink-soft mr-4">{shortDate(m.recorded_at).slice(-5)}</span>
                        <Link to={`/result/${m.id}`} className="font-bold text-teal-dark hover:underline whitespace-nowrap inline-flex items-center gap-1">
                          Открыть <Icon name="chevron" size={13} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-ink-soft text-center">
            Спектр-Диагностика не ставит диагнозы — при тревожных показателях обратитесь к врачу, при критических 103
          </p>
        </>
      ) : (
        <div className="panel p-10 text-center">
          <EmptyArt className="mx-auto mb-2" />
          <h2 className="text-[18px] mb-2">Пока нет замеров</h2>
          <p className="text-sm text-[#5b6b68] mb-5 max-w-sm mx-auto">
            Внесите первый замер — давление, пульс, сон или шаги — и система разберёт показатели и даст рекомендации.
          </p>
          <Link to="/new" className="btn btn-gold">Сделать первый замер</Link>
        </div>
      )}
      </>
      )}
    </div>
  )
}
