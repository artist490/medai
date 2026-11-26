import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import * as api from '../api'
import { Icon } from '../components/Icon'
import { Summary } from '../components/Summary'
import type { IconName } from '../components/Icon'
import type { Measurement, Stats } from '../types'
import type { RiskLevel } from '../types'
import { SkeletonCard, SkeletonRows } from '../components/Skeleton'

const riskLabels: Record<RiskLevel, string> = {
  green: 'Норма',
  yellow: 'Внимание',
  red: 'Тревога',
}
const statusBadgeClass: Record<RiskLevel, string> = {
  green: 'badge-green',
  yellow: 'badge-gold',
  red: 'badge-red',
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

function Chart({ title, subtitle, icon, data, series }: {
  title: string
  subtitle?: string
  icon: IconName
  data: Array<Record<string, unknown>>
  series: Array<{ key: string; name: string; color: string }>
}) {
  if (data.length < 2) return null
  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-[14px] font-medium text-ink flex items-center gap-2">
            <Icon name={icon} size={15} className="opacity-50" /> {title}
          </h2>
          {subtitle && <p className="text-[11.5px] text-ink-soft mt-1">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap gap-4">
          {series.map((s) => (
            <span key={s.key} className="legend-pill">
              <span className="legend-dot" style={{ background: s.color }} />{s.name}
            </span>
          ))}
        </div>
      </div>
      <div style={{ height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eceeec" vertical={false} />
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
            {series.map((s) => (
              <Line
                key={s.key} type="monotone" dataKey={s.key} name={s.name}
                stroke={s.color} strokeWidth={1.6}
                dot={{ r: 2.5, strokeWidth: 0, fill: s.color }}
                activeDot={{ r: 4 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export default function MeasurementsHistory() {
  const [items, setItems] = useState<Measurement[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchParams] = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim().toLowerCase()

  function load() {
    setLoading(true)
    setError('')
    Promise.all([
      api.listMeasurements(100).then((d) => d.items),
      api.fetchStats(),
    ])
      .then(([ms, st]) => {
        setItems(ms)
        setStats(st)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
     
  }, [])

  // Поиск: по дате и любому значению показателей
  const filtered = useMemo(() => {
    if (!query) return items
    return items.filter((m) => {
      const haystack = [
        m.recorded_at,
        m.analysis?.risk_level ?? '',
        String(m.systolic ?? ''), String(m.diastolic ?? ''), String(m.pulse ?? ''),
        String(m.temperature ?? ''), String(m.spo2 ?? ''), String(m.weight_kg ?? ''),
        String(m.sleep_hours ?? ''), String(m.steps ?? ''), String(m.water_ml ?? ''),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [items, query])

  const chartData = useMemo(
    () => (stats?.points ?? []).map((p) => ({ ...p, t: shortDate(p.recorded_at) })),
    [stats],
  )
  const bmiData = useMemo(
    () => (stats?.bmi_points ?? []).map((p) => ({ t: shortDate(p.recorded_at), bmi: p.bmi })),
    [stats],
  )

  if (loading) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
        <SkeletonRows rows={5} />
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-start gap-3">
        <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>
        <button className="btn btn-ghost" onClick={load}>Повторить</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          {query && <p className="text-[12px] text-ink-soft">Поиск: «{query}»</p>}
        </div>
        <Link to="/new" className="btn btn-ghost btn-sm">Новый замер</Link>
      </div>

      <Chart title="Давление" subtitle="мм рт. ст." icon="pressure"
             data={chartData}
             series={[{ key: 'systolic', name: 'Систолическое', color: '#a4231d' },
                      { key: 'diastolic', name: 'Диастолическое', color: '#0b5c58' }]} />
      <Chart title="Пульс" subtitle="уд/мин" icon="pulse"
             data={chartData}
             series={[{ key: 'pulse', name: 'Пульс', color: '#0b5c58' }]} />
      <Chart title="Вес" subtitle="кг" icon="scale"
             data={chartData}
             series={[{ key: 'weight_kg', name: 'Вес', color: '#3d7ea6' }]} />
      <Chart title="ИМТ" subtitle="норма 18.5–24.9" icon="scale"
             data={bmiData}
             series={[{ key: 'bmi', name: 'ИМТ', color: '#a8760a' }]} />
      <Chart title="Сон" subtitle="часы" icon="sleep"
             data={chartData}
             series={[{ key: 'sleep_hours', name: 'Сон', color: '#0b5c58' }]} />
      <Chart title="Активность и вода" icon="steps"
             data={chartData}
             series={[{ key: 'steps', name: 'Шаги', color: '#146c43' },
                      { key: 'water_ml', name: 'Вода, мл', color: '#3d7ea6' }]} />

      {/* Все замеры */}
      <section className="panel">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-[14px] font-medium text-ink">
            Все замеры
            {filtered.length > 0 && <span className="text-ink-soft font-normal"> · {filtered.length}</span>}
          </h2>
        </div>
        <div className="overflow-x-auto" data-full-bleed>
          <table className="data-table">
            <thead>
              <tr>
                <th>Замер</th>
                <th>Статус</th>
                <th className="!text-right">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="text-center text-sm text-ink-soft py-8">
                    {query ? `Ничего не найдено по «${query}»` : (<span className="inline-flex items-center gap-1">Замеров пока нет. Сделайте первый во вкладке «Замер» <Icon name="stethoscope" size={14} /></span>)}
                  </td>
                </tr>
              )}
              {filtered.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className={`row-avatar row-avatar--${m.analysis?.risk_level ?? 'green'}`}>
                        {m.recorded_at.slice(8, 10)}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium">{humanDate(m.recorded_at)}</div>
                        <div className="text-xs text-ink-soft truncate max-w-[420px]"><Summary m={m} /></div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {m.analysis ? (
                      <span className={`${statusBadgeClass[m.analysis.risk_level]} badge`}>
                        {riskLabels[m.analysis.risk_level]}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="!text-right whitespace-nowrap">
                    <span className="text-[12px] text-ink-soft mr-4 tabular-nums">{humanTime(m.recorded_at)}</span>
                    <Link to={`/result/${m.id}`} className="text-[12.5px] text-teal-dark hover:underline underline-offset-2 mr-3">
                      Открыть
                    </Link>
                    <button
                      className="topbar-icon !w-9 !h-9 !text-sm"
                      title="Удалить замер"
                      aria-label="Удалить замер"
                      onClick={async () => {
                        if (!window.confirm('Удалить этот замер?')) return
                        await api.deleteMeasurement(m.id)
                        setItems((prev) => prev.filter((x) => x.id !== m.id))
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
