// Динамика показателей анализов (Д4): значения показателя по датам
// из распознанных документов. Появляется, только если что-то распознано.
import { useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as api from '../../api'
import type { LabTrendPoint } from '../../types'

// Точка графика: отклонение от нормы — тёплый цвет, норма — фирменный
const STATUS_COLORS: Record<string, string> = {
  normal: '#2e7d5b',
  high: '#b07a4a',
  low: '#b07a4a',
  unknown: '#2e7d5b',
}

function fmtDate(iso: string): string {
  const [y, m, d] = (iso || '').slice(0, 10).split('-')
  return y ? `${d}.${m}.${y.slice(2)}` : iso
}

export default function LabTrends() {
  const [keys, setKeys] = useState<Array<{ key: string; label: string }> | null>(null)
  const [selected, setSelected] = useState('')
  const [data, setData] = useState<{ key: string; label: string; items: LabTrendPoint[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.fetchLabKeys()
      .then((d) => {
        setKeys(d.items)
        if (d.items.length > 0) setSelected(d.items[0].key)
      })
      .catch(() => setKeys([]))
  }, [])

  useEffect(() => {
    if (!selected) return
    setError('')
    setData(null)
    api.fetchLabTrend(selected)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить динамику'))
  }, [selected])

  if (keys === null || keys.length === 0) return null

  const points = data?.items ?? []
  const chartData = points.map((p) => ({
    date: fmtDate(p.uploaded_at),
    value: p.value,
    status: p.status ?? 'unknown',
  }))
  const unit = points[0]?.unit || ''

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-[14px] font-medium text-ink">Динамика показателей анализов</h2>
        <select
          className="flip-input !py-1.5 text-[13px] max-w-[240px]"
          value={selected}
          aria-label="Показатель"
          onChange={(e) => setSelected(e.target.value)}
        >
          {keys.map((k) => (
            <option key={k.key} value={k.key}>{k.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="text-[12.5px] text-coral-dark">{error}</div>}
      {!error && data === null && <p className="text-[13px] text-ink-soft">Загружаем динамику…</p>}

      {!error && points.length === 1 && (
        <p className="text-[13px] text-ink-soft">
          Пока один документ с этим показателем — график появится, когда загрузите ещё.
        </p>
      )}

      {points.length >= 2 && (
        <>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eeec" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6a7772' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6a7772' }} tickLine={false} axisLine={false} width={42} />
                <Tooltip
                  formatter={(value: number | string) => [`${value}${unit ? ' ' + unit : ''}`, 'Значение']}
                  labelStyle={{ color: '#1b2622', fontWeight: 600, fontSize: 12 }}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e4ebe9', fontSize: 12 }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#2e7d5b"
                  strokeWidth={2}
                  dot={({ cx, cy, payload }: { cx?: number; cy?: number; payload?: { status?: string } }) => {
                    if (cx === undefined || cy === undefined) return <g />
                    const color = STATUS_COLORS[payload?.status ?? 'unknown'] ?? '#2e7d5b'
                    return <circle cx={cx} cy={cy} r={4} fill={color} stroke="#fff" strokeWidth={1.5} />
                  }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 flex flex-col gap-0.5">
            {points.map((p) => (
              <li key={p.uploaded_at + p.title} className="text-[12px] text-ink-soft tabular-nums flex flex-wrap gap-x-2">
                <span className="text-ink font-medium">{fmtDate(p.uploaded_at)}</span>
                <span>{p.value}{p.unit ? ` ${p.unit}` : ''}</span>
                <span className="truncate max-w-[240px]">{p.title}</span>
                {p.status === 'high' || p.status === 'low' ? (
                  <span className="text-[#b07a4a]">отклонение</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
