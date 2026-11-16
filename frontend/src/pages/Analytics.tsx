// Аналитика филиала для врача: активность замеров, риски, остывшие пациенты.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
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
  green: '#2ba8a2',
  yellow: '#ffd23f',
  red: '#ef6c4a',
}

function Metric(props: { label: string; value: string | number; tone?: 'default' | 'coral' }) {
  return (
    <div className="panel flex-1 min-w-[160px]">
      <div className="text-xs text-[#6b7a77]">{props.label}</div>
      <div className={`text-4xl font-bold mt-1 tabular-nums ${props.tone === 'coral' ? 'text-coral' : 'text-[#1b2622]'}`}>
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
        <p className="font-bold text-coral-dark mb-4">{error}</p>
        <Link to="/patients" className="btn btn-ghost">К пациентам</Link>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <Skeleton w="42%" h={30} r={10} />
        <div className="flex flex-wrap gap-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} w={190} h={110} r={16} />)}
        </div>
        <SkeletonCard lines={4} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 stagger">
      <PageHeader
        eyebrow="Статистика филиала"
        title={<>Аналитика {data.branch_city ? `· ${data.branch_city}` : ''}</>}
        actions={<Link to="/patients" className="btn btn-ghost"><Icon name="chevron-left" size={14} /> К пациентам</Link>}
      />

      {/* Метрики */}
      <div className="flex flex-wrap gap-4">
        <Metric label="Пациентов" value={data.patients_total} />
        <Metric label="Требуют внимания" value={data.requires_attention} tone={data.requires_attention > 0 ? 'coral' : 'default'} />
        <Metric label="Остывшие (14+ дней без замеров)" value={data.stale_patients} />
        <Metric label="Замеров за 14 дней" value={data.measurements_14d.reduce((s, d) => s + d.count, 0)} />
      </div>

      {/* Активность замеров */}
      <section className="panel">
        <h2 className="text-lg">Замеры пациентов за 14 дней</h2>
        <div className="chart-box mt-3" style={{ height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={data.measurements_14d} margin={{ top: 10, right: 16, bottom: 0, left: -14 }}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#6b7a77' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#6b7a77' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e4ebe9', fontSize: 12 }} />
              <Bar dataKey="count" name="Замеры" fill="#1e6f6a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Распределение рисков */}
      <section className="panel">
        <h2 className="text-lg">Последний риск пациентов</h2>
        <div className="mt-4 flex flex-col gap-3">
          {(['green', 'yellow', 'red'] as const).map((k) => {
            const total = data.patients_total || 1
            const pct = Math.round((data.risk_split[k] / total) * 100)
            return (
              <div key={k} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${k === 'green' ? 'bg-[#27ae60]' : k === 'yellow' ? 'bg-[#e6b800]' : 'bg-coral'}`} aria-hidden />
                <span className="text-sm font-semibold text-[#1b2622] w-24">{riskLabels[k]}</span>
                <div className="flex-1 h-2 rounded-full bg-[#f1f6f5] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: riskColors[k] }} />
                </div>
                <span className="text-sm tabular-nums text-[#6b7a77] w-10 text-right">{data.risk_split[k]}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Остывшие пациенты */}
      <section className="panel">
        <h2 className="text-lg">Пациенты и их статус</h2>
        {data.patients.length === 0 ? (
          <p className="text-sm text-[#8aa09c] font-semibold mt-2">Пациентов в филиале пока нет</p>
        ) : (
          <div className="mt-3 divide-y divide-[#eef4f3]">
            {data.patients.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <Link to={`/patients/${p.id}`} className="font-semibold text-[#1b2622] hover:text-teal-dark">
                  {p.name || '(без имени)'}
                </Link>
                <span className="ml-auto text-xs text-[#8aa09c]">
                  {p.last_at ? `последний замер: ${p.last_at.slice(0, 16).replace('T', ' ')}` : 'замеров нет'}
                </span>
                {p.last_risk && (
                  <span className={`w-1.5 h-1.5 rounded-full ${p.last_risk === 'red' ? 'bg-coral' : p.last_risk === 'yellow' ? 'bg-[#e6b800]' : 'bg-[#27ae60]'}`} aria-hidden />
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
