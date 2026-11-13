import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as api from '../api'
import type { Finding, Measurement, Stats } from '../types'
import type { RiskLevel, Status } from '../types'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'

// Цвета риска / статуса (Flip7-палитра)
const riskColors: Record<RiskLevel, string> = {
  green: '#2BA8A2',
  yellow: '#FFD23F',
  red: '#EF6C4A',
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

// Stat-карточка как в референсе: полоса слева, кружок-иконка, бейдж справа сверху
function StatCard(props: {
  tile: 'gold' | 'teal' | 'coral' | 'sky'
  icon: IconName
  accent: string
  label: string
  value: string
  unit?: string
  status?: Status
}) {
  return (
    <div className="stat-card" style={{ borderLeftColor: props.accent }}>
      <div className="flex items-start justify-between gap-2">
        <span className={`icon-tile icon-tile--${props.tile}`}><Icon name={props.icon} size={24} /></span>
        <StatusPill status={props.status} />
      </div>
      <div className="stat-label mt-4">{props.label}</div>
      <div className="stat-value mt-1">
        {props.value}
        {props.unit && <span className="text-xs font-bold text-teal-dark/50 ml-1">{props.unit}</span>}
      </div>
    </div>
  )
}

function shortDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function humanDate(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function humanTime(iso: string): string {
  const d = new Date(iso.replace(' ', 'T'))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Краткое описание замера для таблицы
function summaryOf(m: Measurement): string {
  const parts: string[] = []
  if (m.systolic != null) parts.push(`${m.systolic}/${m.diastolic ?? '—'}`)
  if (m.pulse != null) parts.push(`❤ ${m.pulse}`)
  if (m.temperature != null) parts.push(`🌡 ${m.temperature}°`)
  if (m.spo2 != null) parts.push(`💨 ${m.spo2}%`)
  if (m.weight_kg != null) parts.push(`⚖ ${m.weight_kg} кг`)
  if (m.sleep_hours != null) parts.push(`😴 ${m.sleep_hours} ч`)
  if (m.steps != null) parts.push(`👟 ${m.steps}`)
  if (m.water_ml != null) parts.push(`💧 ${m.water_ml}`)
  return parts.join('  ·  ')
}

export default function Dashboard() {
  const [items, setItems] = useState<Measurement[]>([])
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    api.listMeasurements(10).then((d) => setItems(d.items)).catch(() => {})
    api.fetchStats().then(setStats).catch(() => {})
  }, [])

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

  // График давления
  const bpData = useMemo(
    () => (stats?.points ?? [])
      .filter((p) => p.systolic != null)
      .map((p) => ({ t: shortDate(p.recorded_at), systolic: p.systolic, diastolic: p.diastolic })),
    [stats],
  )

  const bpStatus = findingByKey(a?.findings, 'blood_pressure')?.status
  const pulseStatus = findingByKey(a?.findings, 'pulse')?.status
  const sleepStatus = findingByKey(a?.findings, 'sleep')?.status
  const bmiStatus = findingByKey(a?.findings, 'bmi')?.status

  // Последний замер, где показатель вообще измерялся (для карточек)
  const bpItem = items.find((m) => m.systolic != null)
  const pulseItem = items.find((m) => m.pulse != null)
  const sleepItem = items.find((m) => m.sleep_hours != null)
  const bmiItem = items.find((m) => m.analysis?.bmi != null)
  const bpFinding = findingByKey(bpItem?.analysis?.findings, 'blood_pressure')
  const pulseFinding = findingByKey(pulseItem?.analysis?.findings, 'pulse')
  const sleepFinding = findingByKey(sleepItem?.analysis?.findings, 'sleep')
  const bmiFinding = findingByKey(bmiItem?.analysis?.findings, 'bmi')

  return (
    <div className="flex flex-col gap-6">
      {/* Hero: надзаголовок + заголовок + действия */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Обзор здоровья</div>
          <h1 className="text-4xl mt-1.5" style={{ fontSize: 36 }}>Медицинский дашборд</h1>
        </div>
        <div className="flex items-center gap-3">
          {latest && (
            <Link to={`/result/${latest.id}`} className="btn btn-ghost">
              <Icon name="pulse" size={18} /> Последний замер
            </Link>
          )}
          <Link to="/new" className="btn btn-gold">+ Новый замер</Link>
        </div>
      </div>

      {latest && a ? (
        <>
          {/* Stat-карточки: последнее доступное значение каждого показателя */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard
              tile="coral" icon="pressure" accent="#EF6C4A" label="Давление"
              value={bpItem ? `${bpItem.systolic}/${bpItem.diastolic ?? '—'}` : '—'}
              unit={bpItem ? 'мм рт. ст.' : undefined}
              status={bpFinding?.status}
            />
            <StatCard
              tile="teal" icon="pulse" accent="#2BA8A2" label="Пульс"
              value={pulseItem ? String(pulseItem.pulse) : '—'}
              unit={pulseItem ? 'уд/мин' : undefined}
              status={pulseFinding?.status}
            />
            <StatCard
              tile="sky" icon="sleep" accent="#5DADE2" label="Сон"
              value={sleepItem ? String(sleepItem.sleep_hours) : '—'}
              unit={sleepItem ? 'ч' : undefined}
              status={sleepFinding?.status}
            />
            <StatCard
              tile="gold" icon="scale" accent="#FFD23F" label="ИМТ"
              value={bmiItem ? String(bmiItem.analysis!.bmi) : '—'}
              unit={bmiItem ? 'кг/м²' : undefined}
              status={bmiFinding?.status}
            />
          </div>

          {/* График + donut */}
          <div className="grid lg:grid-cols-[2fr_1fr] gap-5">
            <section className="panel">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-xl">Давление в динамике</h2>
                  <p className="text-sm text-teal-dark/60 mt-0.5">Систолическое и диастолическое по замерам</p>
                </div>
                <div className="flex gap-2">
                  <span className="legend-pill"><span className="legend-dot" style={{ background: '#EF6C4A' }} />Систолическое</span>
                  <span className="legend-pill"><span className="legend-dot" style={{ background: '#2BA8A2' }} />Диастолическое</span>
                </div>
              </div>
              <div className="chart-box" style={{ height: 300 }}>
                {bpData.length >= 2 ? (
                  <ResponsiveContainer>
                    <LineChart data={bpData} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
                      <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#1b2622', fontWeight: 600 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#1b2622', fontWeight: 600 }} domain={['auto', 'auto']} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ borderRadius: 12, border: '2px solid #2ba8a2', fontSize: 12 }} />
                      <Line type="monotone" dataKey="systolic" name="Систолическое" stroke="#EF6C4A" strokeWidth={3.5} dot={{ r: 4, strokeWidth: 0, fill: '#EF6C4A' }} />
                      <Line type="monotone" dataKey="diastolic" name="Диастолическое" stroke="#2BA8A2" strokeWidth={3.5} dot={{ r: 4, strokeWidth: 0, fill: '#2BA8A2' }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full grid place-items-center text-sm text-teal-dark/50 font-bold">
                    Нужно минимум 2 замера с давлением 📈
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <h2 className="text-xl">Структура замеров</h2>
              <p className="text-sm text-teal-dark/60 mt-0.5 mb-4">Распределение по уровню риска</p>
              <div className="chart-box relative" style={{ height: 230 }}>
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
                        <div className="text-2xl font-extrabold text-[#1b2622]">{totalMeasured}</div>
                        <div className="text-[10px] font-extrabold tracking-[2px] uppercase text-teal-dark/50">замеров</div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="h-full grid place-items-center text-sm text-teal-dark/50 font-bold">Нет данных</div>
                )}
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {donutData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2.5 text-sm font-bold text-[#1b2622]">
                    <span className="legend-dot" style={{ background: d.color }} />
                    {d.name}
                    <span className="ml-auto text-teal-dark/60">
                      {totalMeasured ? Math.round((d.value / totalMeasured) * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Последние замеры */}
          <section className="bg-white rounded-[20px] p-6" style={{ boxShadow: '0 6px 24px rgba(23,46,42,.06)' }}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-xl">Последние замеры</h2>
              <Link to="/history" className="btn btn-ghost btn-sm">Вся история →</Link>
            </div>
            <div className="overflow-x-auto">
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
                            <div className="font-extrabold">{humanDate(m.recorded_at)}</div>
                            <div className="text-xs text-teal-dark/60 truncate max-w-[420px]">{summaryOf(m)}</div>
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
                        <span className="text-sm text-teal-dark/60 mr-4">{humanTime(m.recorded_at)}</span>
                        <Link to={`/result/${m.id}`} className="font-extrabold text-teal hover:text-teal-light whitespace-nowrap">
                          Открыть →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-[10px] font-extrabold uppercase tracking-[2px] text-teal-dark/35 text-center">
            ⚕️ MedAI не ставит диагнозы — при тревожных показателях обратитесь к врачу, при критических 103
          </p>
        </>
      ) : (
        <div className="bg-white rounded-[20px] p-10 text-center" style={{ boxShadow: '0 6px 24px rgba(23,46,42,.06)' }}>
          <Icon name="stethoscope" size={52} className="mb-3" />
          <h2 className="text-xl mb-2">Пока нет замеров</h2>
          <p className="text-sm text-teal-dark/70 mb-5">
            Внесите первый замер — давление, пульс, сон или шаги — и MedAI разберёт показатели и даст рекомендации.
          </p>
          <Link to="/new" className="btn btn-gold">Сделать первый замер</Link>
        </div>
      )}

      {/* Пустое состояние — иконка стетоскопа */}
    </div>
  )
}
