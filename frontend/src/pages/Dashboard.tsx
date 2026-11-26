// Дашборд пациента: сводка по последним замерам.
// Композиция — редакционная: заголовок, ключевой показатель, полоса
// вторичных метрик, динамика, таблица. Один акцентный цвет, статусы —
// точкой и словом, без цветных плашек.
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
  green: '#0b5c58',
  yellow: '#a8760a',
  red: '#a4231d',
}
const riskLabels: Record<RiskLevel, string> = {
  green: 'Норма',
  yellow: 'Внимание',
  red: 'Тревога',
}
const statusText: Record<Status, string> = {
  ok: 'норма',
  warn: 'внимание',
  alarm: 'тревога',
}
const statusClass: Record<Status, string> = {
  ok: 'badge-green',
  warn: 'badge-gold',
  alarm: 'badge-red',
}

function findingByKey(findings: Finding[] | undefined, key: string): Finding | undefined {
  return findings?.find((f) => f.key === key)
}

function StatusText({ status }: { status?: Status }) {
  if (!status) return <span className="badge text-ink-soft">нет данных</span>
  return <span className={`${statusClass[status]} badge`}>{statusText[status]}</span>
}

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function humanDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

// Ячейка полосы вторичных показателей
function MetricCell(props: {
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
      <div className="flex items-center justify-between gap-2">
        <span className="stat-label flex items-center gap-1.5">
          <Icon name={props.icon} size={14} className="opacity-50" />
          {props.label}
        </span>
        <StatusText status={props.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 min-h-[30px]">
        {props.value === '—' ? (
          <span className="text-[13px] text-ink-soft">нет данных</span>
        ) : (
          <>
            <span className="text-[24px] font-semibold tracking-[-0.02em] tabular-nums whitespace-nowrap">
              {props.value}
            </span>
            {props.unit && <span className="text-[12px] text-ink-soft whitespace-nowrap">{props.unit}</span>}
          </>
        )}
      </div>
      {progress !== null ? (
        <div className="mt-2">
          <div className="h-1 rounded-full bg-[#eceeec] overflow-hidden">
            <div className="h-full rounded-full bg-teal-dark" style={{ width: progress + '%' }} />
          </div>
          <div className="mt-1.5 text-[11.5px] text-ink-soft tabular-nums">
            {progress}% до цели {props.goal} {props.goalUnit ?? ''}
          </div>
        </div>
      ) : (
        props.hint && <div className="mt-1.5 text-[11.5px] text-ink-soft">{props.hint}</div>
      )}
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

  const lastNote = useMemo(() => {
    const all = items.flatMap((m) => (m.analysis?.notes ?? []).map((n) => ({ ...n })))
    all.sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
    return all[0] ?? null
  }, [items])

  return (
    <div className="flex flex-col gap-6 stagger">
      <PageHeader
        eyebrow={latest ? `Последний замер · ${shortDate(latest.recorded_at)}` : undefined}
        title="Обзор здоровья"
        actions={
          <>
            {latest && (
              <Link to={`/result/${latest.id}`} className="btn btn-ghost">
                Последний разбор
              </Link>
            )}
            <Link to="/new" className="btn btn-gold">
              <Icon name="pressure" size={16} /> Новый замер
            </Link>
          </>
        }
      />

      {loading && (
        <div className="flex flex-col gap-5" aria-busy>
          <Skeleton w="45%" h={26} r={4} />
          <SkeletonCard lines={4} />
          <SkeletonRows rows={4} />
        </div>
      )}

      {!loading && error && (
        <div className="flex flex-col items-start gap-3">
          <div className="text-[13px] text-coral-dark">{error}</div>
          <button className="btn btn-ghost" onClick={load}>Повторить</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {nextVisit && (
            <Link
              to="/medcard"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-line rounded-lg px-4 py-3 bg-white hover:border-[#cfd6d2] transition-quick"
            >
              <span className="text-[12px] uppercase tracking-[0.06em] text-teal-dark font-medium">
                Приём назначен
              </span>
              <span className="text-[13.5px] text-ink">
                {nextVisit.visit_date
                  ? `${nextVisit.visit_date.slice(8, 10)}.${nextVisit.visit_date.slice(5, 7)}.${nextVisit.visit_date.slice(0, 4)}`
                  : 'дата уточняется'}
                {nextVisit.reason ? ` · ${nextVisit.reason}` : ''}
              </span>
              <span className="ml-auto text-[12px] text-ink-soft inline-flex items-center gap-1">
                Медкарта <Icon name="chevron" size={12} />
              </span>
            </Link>
          )}

          {latest && a ? (
            <>
              {showEveningReminder && (
                <div className="flex flex-wrap items-center gap-3 border border-line rounded-lg bg-white px-4 py-3">
                  <span className="text-[13px] text-ink">
                    Вечерний замер ещё не сделан.
                  </span>
                  <button className="btn btn-ghost btn-sm ml-auto" disabled={repeatBusy} onClick={repeatEvening}>
                    {repeatBusy ? 'Добавляем…' : 'Повторить вечерний'}
                  </button>
                </div>
              )}
              {repeatMsg && (
                <div className={`text-[12.5px] ${repeatMsg.kind === 'ok' ? 'text-[#146c43]' : 'text-coral-dark'}`}>
                  {repeatMsg.text}
                </div>
              )}

              {/* Ключевой показатель + структура замеров */}
              <div className="grid lg:grid-cols-[1.9fr_1fr] gap-5 items-stretch">
                <section className="panel flex flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <span className="stat-label flex items-center gap-1.5">
                      <Icon name="pressure" size={14} className="opacity-50" />
                      Артериальное давление
                    </span>
                    <StatusText status={bpFinding?.status} />
                  </div>

                  <div className="mt-4 flex flex-wrap items-baseline gap-x-2.5">
                    {bpItem ? (
                      <>
                        <span className="text-[46px] leading-none font-semibold tracking-[-0.035em] tabular-nums">
                          {bpItem.systolic}/{bpItem.diastolic ?? '—'}
                        </span>
                        <span className="text-[12.5px] text-ink-soft">мм рт. ст.</span>
                      </>
                    ) : (
                      <span className="text-[15px] text-ink-soft">Нет замеров с давлением</span>
                    )}
                  </div>

                  {bpFinding ? (
                    <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft max-w-[54ch]">
                      {bpFinding.message}
                    </p>
                  ) : (
                    <p className="mt-3 text-[13.5px] text-ink-soft">
                      Норма для взрослых — 120/80 мм рт. ст.
                    </p>
                  )}

                  {bpItem && (
                    <div className="mt-5 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-soft">
                      <span className="tabular-nums">{shortDate(bpItem.recorded_at)}</span>
                      <Link to={`/result/${bpItem.id}`} className="hero-detail-link text-[12.5px]">
                        Разбор замера <Icon name="chevron" size={12} />
                      </Link>
                    </div>
                  )}
                </section>

                <section className="panel flex flex-col">
                  <h2 className="text-[14px] font-medium text-ink">Структура замеров</h2>
                  <div className="relative flex-1 mt-2" style={{ minHeight: 168 }}>
                    {totalMeasured > 0 ? (
                      <>
                        <ResponsiveContainer>
                          <PieChart>
                            <Pie
                              data={donutData}
                              dataKey="value"
                              innerRadius="74%"
                              outerRadius="94%"
                              startAngle={90}
                              endAngle={-270}
                              paddingAngle={2}
                              stroke="none"
                            >
                              {donutData.map((d) => <Cell key={d.name} fill={d.color} />)}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 grid place-items-center pointer-events-none">
                          <div className="text-center">
                            <div className="text-[22px] font-semibold tabular-nums leading-none">{totalMeasured}</div>
                            <div className="text-[10.5px] text-ink-soft mt-1">замеров</div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="h-full grid place-items-center text-[13px] text-ink-soft">Нет данных</div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1.5">
                    {donutData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2 text-[12.5px] text-ink">
                        <span className="legend-dot" style={{ background: d.color }} />
                        {d.name}
                        <span className="ml-auto text-ink-soft tabular-nums">
                          {totalMeasured ? Math.round((d.value / totalMeasured) * 100) : 0}%
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Вторичные показатели */}
              <div className="stat-strip">
                <MetricCell
                  icon="pulse" label="Пульс"
                  value={pulseItem ? String(pulseItem.pulse) : '—'}
                  unit={pulseItem ? 'уд/мин' : undefined}
                  status={pulseFinding?.status}
                  hint={pulseFinding ? 'Норма 60–100' : 'Норма 60–100 уд/мин'}
                />
                <MetricCell
                  icon="sleep" label="Сон"
                  value={sleepItem ? String(sleepItem.sleep_hours) : '—'}
                  unit={sleepItem ? 'ч' : undefined}
                  status={sleepFinding?.status}
                  goal={goals.sleep ?? undefined}
                  goalUnit="ч"
                  hint={sleepFinding ? 'Норма 7–9' : 'Здесь появится продолжительность сна'}
                />
                <MetricCell
                  icon="scale" label="ИМТ"
                  value={bmiItem ? String(bmiItem.analysis!.bmi) : '—'}
                  unit={bmiItem ? 'кг/м²' : undefined}
                  status={bmiFinding?.status}
                  hint={bmiFinding ? 'Норма 18.5–24.9' : 'Нужен рост в профиле'}
                />
              </div>

              {/* Динамика + комментарий врача */}
              <div className="grid lg:grid-cols-[1.9fr_1fr] gap-5 items-stretch">
                <section className="panel">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <h2 className="text-[14px] font-medium text-ink">Давление в динамике</h2>
                    <div className="flex gap-4">
                      <span className="legend-pill"><span className="legend-dot" style={{ background: riskColors.red }} />Систолическое</span>
                      <span className="legend-pill"><span className="legend-dot" style={{ background: riskColors.green }} />Диастолическое</span>
                    </div>
                  </div>
                  <div style={{ height: 260 }}>
                    {bpData.length >= 2 ? (
                      <ResponsiveContainer>
                        <LineChart data={bpData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                          <XAxis
                            dataKey="t"
                            tick={{ fontSize: 10.5, fill: '#7b8681' }}
                            tickLine={false}
                            axisLine={{ stroke: '#e3e6e3' }}
                          />
                          <YAxis
                            tick={{ fontSize: 10.5, fill: '#7b8681' }}
                            domain={['auto', 'auto']}
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              borderRadius: 6,
                              border: '1px solid #e3e6e3',
                              fontSize: 12,
                              boxShadow: '0 8px 24px -16px rgba(19,26,24,.3)',
                            }}
                          />
                          <Line
                            type="monotone" dataKey="systolic" name="Систолическое"
                            stroke={riskColors.red} strokeWidth={1.6}
                            dot={{ r: 2.5, strokeWidth: 0, fill: riskColors.red }}
                            activeDot={{ r: 4 }}
                          />
                          <Line
                            type="monotone" dataKey="diastolic" name="Диастолическое"
                            stroke={riskColors.green} strokeWidth={1.6}
                            dot={{ r: 2.5, strokeWidth: 0, fill: riskColors.green }}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full grid place-items-center text-[13px] text-ink-soft text-center px-6">
                        Для графика нужно минимум два замера с давлением
                      </div>
                    )}
                  </div>
                </section>

                <section className="panel flex flex-col">
                  <h2 className="text-[14px] font-medium text-ink">Комментарий врача</h2>
                  {lastNote ? (
                    <div className="mt-3 pt-3 border-t border-line">
                      <div className="text-[11.5px] text-ink-soft flex items-center gap-1.5">
                        <AvatarDoctor size={18} /> {lastNote.doctor_name} · {lastNote.created_at.slice(0, 16)}
                      </div>
                      <p className="text-[13.5px] leading-relaxed text-ink mt-2">{lastNote.text}</p>
                    </div>
                  ) : (
                    <p className="text-[13px] text-ink-soft mt-3 leading-relaxed">
                      Заметок пока нет — врач оставит их после разбора замеров.
                    </p>
                  )}
                </section>
              </div>

              {/* Последние замеры */}
              <section className="panel">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <h2 className="text-[14px] font-medium text-ink">Последние замеры</h2>
                  <Link to="/history" className="text-[12.5px] text-teal-dark hover:underline underline-offset-2 inline-flex items-center gap-1">
                    Вся история <Icon name="chevron" size={12} />
                  </Link>
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
                                <div className="font-medium">{humanDate(m.recorded_at)}</div>
                                <div className="text-[12px] text-ink-soft truncate max-w-[420px]"><Summary m={m} /></div>
                              </div>
                            </div>
                          </td>
                          <td>
                            {m.analysis && (
                              <span className={`${statusClass[m.analysis.risk_level === 'green' ? 'ok' : m.analysis.risk_level === 'yellow' ? 'warn' : 'alarm']} badge`}>
                                {riskLabels[m.analysis.risk_level]}
                              </span>
                            )}
                          </td>
                          <td className="!text-right">
                            <span className="text-[12px] text-ink-soft mr-4 tabular-nums">{shortDate(m.recorded_at).slice(-5)}</span>
                            <Link to={`/result/${m.id}`} className="text-[12.5px] text-teal-dark hover:underline underline-offset-2 whitespace-nowrap">
                              Открыть
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <p className="text-[11.5px] text-ink-soft">
                Сервис не ставит диагноз. При тревожных показателях обратитесь к врачу,
                при критических — звоните 103.
              </p>
            </>
          ) : (
            <section className="panel py-14 px-6 text-center">
              <EmptyArt className="mx-auto mb-4 opacity-70" />
              <h2 className="text-[17px] font-semibold">Пока нет замеров</h2>
              <p className="text-[13.5px] text-ink-soft mt-2 mb-5 max-w-[46ch] mx-auto leading-relaxed">
                Внесите первый замер — давление, пульс, сон или шаги — и система
                разберёт показатели и покажет динамику.
              </p>
              <Link to="/new" className="btn btn-gold">Сделать первый замер</Link>
            </section>
          )}
        </>
      )}
    </div>
  )
}
