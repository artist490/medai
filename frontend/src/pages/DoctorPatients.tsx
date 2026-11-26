// Кабинет врача: пациенты клиники, требующие внимания — сверху.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import * as api from '../api'
import { Icon } from '../components/Icon'
import type { PatientRow } from '../types'
import type { RiskLevel } from '../types'
import { brand } from '../brand'
import { useAuth } from '../auth'
import AvatarPatient from '../components/AvatarPatient'
import PageHeader from '../components/PageHeader'
import { SkeletonRows } from '../components/Skeleton'

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

function PatientAvatar({ p, size = 'md' }: { p: PatientRow; size?: 'sm' | 'md' }) {
  const cls = p.last_risk ? `row-avatar--${p.last_risk}` : 'row-avatar--green'
  return (
    <span className={`row-avatar ${cls} ${size === 'sm' ? '!w-8 !h-8' : ''}`}>
      <AvatarPatient size={size === 'sm' ? 20 : 26} />
    </span>
  )
}

function AttentionCard({ p }: { p: PatientRow }) {
  return (
    <Link
      to={`/patients/${p.id}`}
      className="flip-card flip-card--danger block hover:bg-[#fafbfa] transition-quick"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink flex items-center gap-2">
          <Icon name="warning" size={15} className="text-coral-dark" />
          {p.name || p.email}
        </span>
        <span className="badge badge-red">тревога</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-soft mt-2">
        {(p.survey_alarms ?? 0) > 0
          ? `Опросник: ${p.survey_alarms} ${p.survey_alarms === 1 ? 'тревожный пункт' : 'тревожных пункта'}. `
          : `Последний замер ${shortDate(p.last_measurement_at)} — риск «Тревога». `}
        Требуется разбор.
      </p>
    </Link>
  )
}

export default function DoctorPatients() {
  const { user } = useAuth()
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

  // Один и тот же предикат поиска для обеих секций: найденный тревожный
  // пациент остаётся карточкой в «Требуют внимания», а не исчезает из выдачи
  const matchesQuery = useCallback(
    (p: PatientRow) =>
      !query ||
      (p.name || '').toLowerCase().includes(query) ||
      p.email.toLowerCase().includes(query),
    [query],
  )
  const attention = useMemo(
    () => items.filter((p) => p.requires_attention && matchesQuery(p)),
    [items, matchesQuery],
  )
  const others = useMemo(
    () => items.filter((p) => !p.requires_attention && matchesQuery(p)),
    [items, matchesQuery],
  )

  return (
    <div className="flex flex-col gap-6 stagger">
      <PageHeader
        eyebrow={user?.branch ? `Филиал · ${user.branch.city}` : undefined}
        title="Пациенты клиники"
        sub="Сверху — те, кому нужен разбор. Остальные отсортированы по последнему замеру."
      />

      {error && <div className="text-[12.5px] text-coral-dark">{error}</div>}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <>
          {attention.length > 0 && (
            <section>
              <h2 className="text-[13px] uppercase tracking-[0.06em] text-ink-soft font-medium mb-3">
                Требуют внимания · {attention.length}
              </h2>
              <div className="grid md:grid-cols-2 gap-3">
                {attention.map((p) => <AttentionCard key={p.id} p={p} />)}
              </div>
            </section>
          )}

          <section className="panel">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h2 className="text-[14px] font-medium text-ink">
                Все пациенты
                {others.length > 0 && <span className="text-ink-soft font-normal"> · {others.length}</span>}
              </h2>
              {query && <span className="text-[12px] text-ink-soft">поиск: «{query}»</span>}
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
                  {/* «Никого не найдено» — только когда после фильтра пусты оба списка */}
                  {others.length === 0 && attention.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-[13px] text-ink-soft py-8">
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
                            <div className="font-medium">{p.name || '(без имени)'}</div>
                            <div className="text-[12px] text-ink-soft">{p.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="tabular-nums">{p.age ?? '—'}</td>
                      <td>
                        <div className="tabular-nums">{shortDate(p.last_measurement_at)}</div>
                        <div className="text-[12px] text-ink-soft">всего: {p.total}</div>
                      </td>
                      <td>
                        <div className="flex flex-col gap-1.5 items-start">
                          {p.last_risk ? (
                            <span className={`${riskBadge[p.last_risk]} badge`}>{riskLabels[p.last_risk]}</span>
                          ) : <span className="text-ink-soft">—</span>}
                          {(p.unread_signals ?? 0) > 0 && (
                            <span className="flex items-center gap-1.5 text-[12px] text-coral-dark">
                              <span className="w-1.5 h-1.5 rounded-full bg-coral" aria-hidden />
                              {p.unread_signals} новых сигналов
                            </span>
                          )}
                          {(p.survey_alarms ?? 0) > 0 && (
                            <span className="badge badge-red">опросник: {p.survey_alarms}</span>
                          )}
                          {(p.planned_visits ?? 0) > 0 && (
                            <span className="badge badge-teal">
                              приём {p.planned_visits === 1 ? 'запланирован' : `× ${p.planned_visits}`}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-[12px] text-ink-soft whitespace-nowrap tabular-nums">
                        <span className="mr-3 inline-flex items-center gap-1"><Icon name="check" size={11} />{p.counts.green}</span>
                        <span className="mr-3 inline-flex items-center gap-1"><Icon name="warning" size={11} />{p.counts.yellow}</span>
                        <span className="inline-flex items-center gap-1"><Icon name="alarm" size={11} />{p.counts.red}</span>
                      </td>
                      <td className="!text-right">
                        <Link
                          to={`/patients/${p.id}`}
                          className="text-[12.5px] text-teal-dark hover:underline underline-offset-2 whitespace-nowrap"
                        >
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
            Данные пациентов конфиденциальны — доступ есть только у врачей {brand.name}.
          </p>
        </>
      )}
    </div>
  )
}
