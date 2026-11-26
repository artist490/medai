import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../api'
import RiskBadge from '../components/RiskBadge'
import IndicatorCard from '../components/IndicatorCard'
import AvatarDoctor from '../components/AvatarDoctor'
import Disclaimer from '../components/Disclaimer'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import PageHeader from '../components/PageHeader'
import { SkeletonCard } from '../components/Skeleton'
import { brand } from '../brand'
import { useAuth } from '../auth'
import type { Measurement } from '../types'

const ADVICE_ICONS: IconName[] = ['bulb', 'run', 'water', 'salad', 'sleep', 'clock']

export default function Result() {
  const { id } = useParams()
  const { user } = useAuth()
  const [m, setM] = useState<Measurement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getMeasurement(id!)
      .then(setM)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [id])

  if (error) {
    return (
      <div className="panel p-8 text-center">
        <p className="text-[13.5px] text-coral-dark mb-4">{error}</p>
        <Link to="/" className="btn btn-ghost">На главную</Link>
      </div>
    )
  }
  if (!m) return <div aria-busy><SkeletonCard lines={4} /></div>

  const a = m.analysis!
  const hasAlarm = a.findings.some((f) => f.status === 'alarm')

  return (
    <div className="flex flex-col gap-6 stagger">
      <PageHeader
        eyebrow={`Разбор от ${a.created_at.slice(0, 16)}`}
        title="Разбор замера"
        actions={
          <>
            <RiskBadge level={a.risk_level} big />
            <Link to="/new" className="btn btn-ghost">
              <Icon name="pressure" size={16} /> Новый замер
            </Link>
          </>
        }
      />

      {hasAlarm && (
        <div className="flip-card flip-card--danger">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-coral-dark">
            <Icon name="warning" size={17} /> Обратитесь к врачу
          </div>
          <p className="text-[13px] leading-relaxed text-ink-soft mt-1.5 max-w-[70ch]">
            Есть тревожные показатели. Не ждите ухудшения — запишитесь к терапевту
            или позвоните в клинику:{' '}
            <span className="text-ink font-medium">{user?.branch?.phone || brand.phone}</span>.
            При критических значениях звоните 103.
          </p>
        </div>
      )}

      <section>
        <h2 className="text-[14px] font-medium text-ink mb-3">Показатели</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {a.findings.map((f) => (
            <IndicatorCard key={f.key} finding={f} />
          ))}
        </div>
      </section>

      {a.notes && a.notes.length > 0 && (
        <section>
          <h2 className="text-[14px] font-medium text-ink mb-3">Комментарий врача</h2>
          <div className="flex flex-col gap-2">
            {a.notes.map((n) => (
              <div key={n.id} className="flip-card">
                <div className="text-[11.5px] text-ink-soft flex items-center gap-1.5">
                  <AvatarDoctor size={18} /> {n.doctor_name} · {n.created_at.slice(0, 16)}
                </div>
                <p className="text-[13.5px] leading-relaxed text-ink mt-2">{n.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-[14px] font-medium text-ink">Что можно сделать</h2>
          {a.llm_summary && (
            <span className="text-[11.5px] text-ink-soft">
              Сформулировано языковой моделью по вашим показателям
            </span>
          )}
        </div>

        <div className="panel">
          {a.llm_summary && (
            <p className="text-[13.5px] leading-relaxed text-ink max-w-[78ch] mb-4 pb-4 border-b border-line">
              {a.llm_summary}
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {(a.llm_items ?? a.recommendations).map((item, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-relaxed text-ink">
                <Icon
                  name={ADVICE_ICONS[i % ADVICE_ICONS.length]}
                  size={16}
                  className="mt-0.5 text-teal-dark"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {!a.llm_summary && (
            <p className="text-[11.5px] text-ink-soft mt-4 pt-3 border-t border-line">
              Рекомендации составлены по медицинским нормам — без обращения к языковой модели.
            </p>
          )}
        </div>
      </section>

      <Disclaimer urgent={a.risk_level === 'red'} phone={user?.branch?.phone} />

      <p className="text-[11.5px] text-ink-soft">
        Источник анализа: {a.source === 'rules+llm' ? 'база правил и языковая модель' : 'база правил'}.
        Показатели передаются внешнему провайдеру модели, данные хранятся в РФ.
      </p>
    </div>
  )
}
