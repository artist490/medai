// Кабинет врача: пациенты клиники, требующие внимания — сверху.
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as api from '../api'
import { Icon } from '../components/Icon'
import type { PatientRow } from '../types'
import type { RiskLevel } from '../types'
import { brand } from '../brand'

const riskBadge: Record<RiskLevel, string> = {
  green: 'badge-green',
  yellow: 'badge-gold',
  red: 'badge-red',
}
const riskLabels: Record<RiskLevel, string> = {
  green: 'Норма',
  yellow: 'Внимание',
  red: 'Тревога',
}

function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.replace(' ', 'T'))
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function initialsOf(name: string, email: string): string {
  const base = (name || email || '?').trim()
  return base.slice(0, 2).toUpperCase()
}

function PatientAvatar({ p, size = 'md' }: { p: PatientRow; size?: 'sm' | 'md' }) {
  const cls = p.last_risk ? `row-avatar--${p.last_risk}` : 'row-avatar--green'
  return (
    <span className={`row-avatar ${cls} ${size === 'sm' ? '!w-8 !h-8 !text-xs' : ''}`}>
      {initialsOf(p.name, p.email)}
    </span>
  )
}

function AttentionCard({ p }: { p: PatientRow }) {
  return (
    <Link
      to={`/patients/${p.id}`}
      className="flip-card flip-card--danger block hover:scale-[1.01] transition-quick"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="font-extrabold text-teal-dark flex items-center gap-2">
          <Icon name="warning" size={18} /> {p.name || p.email}
        </span>
        <span className="badge badge-red">тревога</span>
      </div>
      <p className="text-sm text-teal-dark/85">
        Последний замер {shortDate(p.last_measurement_at)} — риск «Тревога».
        Требуется разбор показателей.
      </p>
    </Link>
  )
}

export default function DoctorPatients() {
  const [items, setItems] = useState<PatientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchParams] = useSearchParams()
  const query = (searchParams.get('q') ?? '').trim().toLowerCase()

  useEffect(() => {
    api.fetchPatients()
      .then((d) => setItems(d.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  const attention = useMemo(() => items.filter((p) => p.requires_attention), [items])
  const others = useMemo(() => {
    const rest = items.filter((p) => !p.requires_attention)
    if (!query) return rest
    return rest.filter(
      (p) => (p.name || '').toLowerCase().includes(query) || p.email.toLowerCase().includes(query),
    )
  }, [items, query])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Кабинет врача</div>
          <h1 className="text-4xl mt-1.5" style={{ fontSize: 36 }}>Пациенты клиники</h1>
        </div>
        <span className="badge badge-teal normal-case tracking-normal w-fit">
          Всего пациентов: {items.length}
        </span>
      </div>

      {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}

      {loading ? (
        <div className="text-center font-extrabold text-teal-dark animate-pulse py-10">Загрузка…</div>
      ) : (
        <>
          {attention.length > 0 && (
            <section>
              <div className="section-title mb-3">
                <span className="emoji-box"><Icon name="warning" size={20} /></span>
                Требуют внимания
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {attention.map((p) => <AttentionCard key={p.id} p={p} />)}
              </div>
            </section>
          )}

          <section className="bg-white rounded-[20px] p-6" style={{ boxShadow: '0 6px 24px rgba(23,46,42,.06)' }}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-xl">
                Все пациенты {others.length > 0 && <span className="text-teal-dark/40 text-base">· {others.length}</span>}
              </h2>
              {query && <span className="text-sm text-teal-dark/60">поиск: «{query}»</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Пациент</th>
                    <th>Возраст</th>
                    <th>Последний замер</th>
                    <th>Статус</th>
                    <th>Замеры</th>
                    <th className="!text-right">Разбор</th>
                  </tr>
                </thead>
                <tbody>
                  {others.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-sm text-teal-dark/60 py-8">
                        {query
                          ? `Никого не найдено по «${query}»`
                          : 'Пациентов пока нет — они появятся после регистрации'}
                      </td>
                    </tr>
                  )}
                  {others.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <PatientAvatar p={p} />
                          <div className="min-w-0">
                            <div className="font-extrabold">{p.name || '(без имени)'}</div>
                            <div className="text-xs text-teal-dark/60">{p.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>{p.age ?? '—'}</td>
                      <td>
                        <div className="font-extrabold">{shortDate(p.last_measurement_at)}</div>
                        <div className="text-xs text-teal-dark/60">всего: {p.total}</div>
                      </td>
                      <td>
                        {p.last_risk ? (
                          <span className={`${riskBadge[p.last_risk]} badge`}>{riskLabels[p.last_risk]}</span>
                        ) : '—'}
                      </td>
                      <td className="text-xs text-teal-dark/70 whitespace-nowrap">
                        <span className="mr-2">✅ {p.counts.green}</span>
                        <span className="mr-2">⚠️ {p.counts.yellow}</span>
                        <span>🚨 {p.counts.red}</span>
                      </td>
                      <td className="!text-right">
                        <Link
                          to={`/patients/${p.id}`}
                          className="font-extrabold text-teal hover:text-teal-light whitespace-nowrap"
                        >
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
            ⚕️ Данные пациентов конфиденциальны — доступ только у врачей {brand.name}
          </p>
        </>
      )}
    </div>
  )
}
