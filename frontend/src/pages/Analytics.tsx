// Аналитика филиала для врача: активность замеров, риски, остывшие пациенты.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as api from '../api'
import type { BranchAnalytics } from '../types'
import { Icon } from '../components/Icon'
import PageHeader from '../components/PageHeader'
import { Skeleton, SkeletonCard } from '../components/Skeleton'

const riskLabels: Record<string, string> = {
  green: 'Норма',
  yellow: 'Внимание',
  red: 'Тревога',
}
const riskColors: Record<string, string> = {
  green: '#0b5c58',
  yellow: '#a8760a',
  red: '#a4231d',
}

function Metric(props: { label: string; value: string | number; attention?: boolean }) {
  return (
    <div className="panel flex-1 min-w-[170px]">
      <div className="text-[11.5px] text-ink-soft">{props.label}</div>
      <div
        className={`mt-1.5 text-[26px] font-semibold tracking-[-0.02em] tabular-nums ${
          props.attention ? 'text-coral-dark' : 'text-ink'
        }`}
      >
        {props.value}
      </div>
    </div>
  )
}

export default function Analytics() {
  const [data, setData] = useState<BranchAnalytics | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.fetchAnalytics()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [])

  if (error) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-[13.5px] text-coral-dark mb-4">{error}</p>
        <Link to="/patients" className="btn btn-ghost">К пациентам</Link>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton w="42%" h={26} r={4} />
        <div className="flex flex-wrap gap-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} w={190} h={96} r={8} />)}
        </div>
        <SkeletonCard lines={4} />
      </div>
    )
  }

  const total = data.patients_total || 1

  return (
    <div className="flex flex-col gap-6 stagger">
      <PageHeader
        eyebrow={data.branch_city ? `Филиал · ${data.branch_city}` : undefined}
        title="Аналитика"
        actions={<Link to="/patients" className="btn btn-ghost"><Icon name="chevron-left" size={14} /> К пациентам</Link>}
      />

      <div className="flex flex-wrap gap-4">
        <Metric label="Пациентов в филиале" value={data.patients_total} />
        <Metric label="Требуют внимания" value={data.requires_attention} attention={data.requires_attention > 0} />
        <Metric label="Без замеров 14+ дней" value={data.stale_patients} />
        <Metric label="Замеров за 14 дней" value={data.measurements_14d.reduce((s, d) => s + d.count, 0)} />
      </div>

      <section className="panel">
        <h2 className="text-[14px] font-medium text-ink mb-4">Замеры пациентов за 14 дней</h2>
        <div style={{ height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={data.measurements_14d} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10.5, fill: '#7b8681' }}
                tickLine={false}
                axisLine={{ stroke: '#e3e6e3' }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10.5, fill: '#7b8681' }}
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
              <Bar dataKey="count" name="Замеры" className="analytics-bar" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2 className="text-[14px] font-medium text-ink mb-4">Последний риск пациентов</h2>
        <div className="flex flex-col gap-3">
          {(['green', 'yellow', 'red'] as const).map((k) => {
            const pct = Math.round((data.risk_split[k] / total) * 100)
            return (
              <div key={k} className="flex items-center gap-3">
                <span className="legend-dot" style={{ background: riskColors[k] }} aria-hidden />
                <span className="text-[12.5px] text-ink w-24">{riskLabels[k]}</span>
                <div className="flex-1 h-1.5 rounded-full bg-[#eceeec] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: riskColors[k] }} />
                </div>
                <span className="text-[12.5px] tabular-nums text-ink-soft w-16 text-right">
                  {data.risk_split[k]} · {pct}%
                </span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <h2 className="text-[14px] font-medium text-ink">Пациенты и их статус</h2>
        {data.patients.length === 0 ? (
          <p className="text-[13px] text-ink-soft mt-3">Пациентов в филиале пока нет</p>
        ) : (
          <div className="mt-2 divide-y divide-[#eef0ee]">
            {data.patients.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <Link
                  to={`/patients/${p.id}`}
                  className="text-[13px] text-ink hover:text-teal-dark hover:underline underline-offset-2"
                >
                  {p.name || '(без имени)'}
                </Link>
                <span className="ml-auto text-[11.5px] text-ink-soft tabular-nums">
                  {p.last_at ? `последний замер ${p.last_at.slice(0, 16).replace('T', ' ')}` : 'замеров нет'}
                </span>
                {p.last_risk && (
                  <span className="legend-dot" style={{ background: riskColors[p.last_risk] }} aria-hidden />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
