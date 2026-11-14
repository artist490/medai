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
  subtitle: string
  icon: IconName
  data: Array<Record<string, unknown>>
  series: Array<{ key: string; name: string; color: string }>
}) {
  if (data.length < 2) return null
  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl flex items-center gap-2.5">
            <span className="emoji-box"><Icon name={icon} size={20} /></span> {title}
          </h2>
          <p className="text-sm text-teal-dark/60 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {series.map((s) => (
            <span key={s.key} className="legend-pill">
              <span className="legend-dot" style={{ background: s.color }} />{s.name}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-box" style={{ height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="4 4" stroke="#e3efed" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#1b2622', fontWeight: 600 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#1b2622', fontWeight: 600 }} domain={['auto', 'auto']} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '2px solid #2ba8a2', fontSize: 12 }} />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name}
                    stroke={s.color} strokeWidth={3.5} dot={{ r: 4, strokeWidth: 0, fill: s.color }} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

export default function History() {
  const [items, setItems] = useState<Measurement[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [searchParams] = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim().toLowerCase()

  useEffect(() => {
    api.listMeasurements(100).then((d) => setItems(d.items)).catch(() => {})
    api.fetchStats().then(setStats).catch(() => {})
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

  if (error) return <p className="badge badge-red">{error}</p>

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="eyebrow">Динамика показателей</div>
        <h1 className="text-4xl mt-1.5" style={{ fontSize: 32, letterSpacing: '-0.5px' }}>
          История {query && <span className="text-teal-dark/40">· «{query}»</span>}
        </h1>
      </div>

      <Chart title="Давление, мм рт. ст." subtitle="Систолическое и диастолическое" icon="pressure"
             data={chartData}
             series={[{ key: 'systolic', name: 'Систолическое', color: '#EF6C4A' },
                      { key: 'diastolic', name: 'Диастолическое', color: '#2BA8A2' }]} />
      <Chart title="Пульс, уд/мин" subtitle="Частота сердечных сокращений" icon="pulse"
             data={chartData}
             series={[{ key: 'pulse', name: 'Пульс', color: '#E74C3C' }]} />
      <Chart title="Вес" subtitle="Изменение массы тела" icon="scale"
             data={chartData}
             series={[{ key: 'weight_kg', name: 'Вес, кг', color: '#5DADE2' }]} />
      <Chart title="ИМТ" subtitle="Индекс массы тела, норма 18.5–24.9" icon="scale"
             data={bmiData}
             series={[{ key: 'bmi', name: 'ИМТ', color: '#FFD23F' }]} />
      <Chart title="Сон, часы" subtitle="Продолжительность сна" icon="sleep"
             data={chartData}
             series={[{ key: 'sleep_hours', name: 'Сон', color: '#2BA8A2' }]} />
      <Chart title="Активность и вода" subtitle="Шаги за день и выпитая вода" icon="steps"
             data={chartData}
             series={[{ key: 'steps', name: 'Шаги', color: '#27AE60' },
                      { key: 'water_ml', name: 'Вода, мл', color: '#5DADE2' }]} />

      {/* Все замеры */}
      <section className="bg-white rounded-[20px] p-6" style={{ boxShadow: '0 6px 24px rgba(23,46,42,.06)' }}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-xl">Все замеры {filtered.length > 0 && <span className="text-teal-dark/40 text-base">· {filtered.length}</span>}</h2>
        </div>
        <div className="overflow-x-auto">
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
                  <td colSpan={3} className="text-center text-sm text-teal-dark/60 py-8">
                    {query ? `Ничего не найдено по «${query}»` : (<span className="inline-flex items-center gap-1">Замеров пока нет — сделайте первый во вкладке «Замер» <Icon name="stethoscope" size={14} /></span>)}
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
                        <div className="font-extrabold">{humanDate(m.recorded_at)}</div>
                        <div className="text-xs text-teal-dark/60 truncate max-w-[420px]"><Summary m={m} /></div>
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
                    <span className="text-sm text-teal-dark/60 mr-4">{humanTime(m.recorded_at)}</span>
                    <Link to={`/result/${m.id}`} className="font-extrabold text-teal hover:text-teal-light mr-3">
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
