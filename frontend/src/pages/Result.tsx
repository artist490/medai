import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../api'
import RiskBadge from '../components/RiskBadge'
import IndicatorCard from '../components/IndicatorCard'
import AvatarDoctor from '../components/AvatarDoctor'
import Disclaimer from '../components/Disclaimer'
import Confetti from '../components/Confetti'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import PageHeader from '../components/PageHeader'
import { SkeletonCard } from '../components/Skeleton'
import { brand } from '../brand'
import { useAuth } from '../auth'
import type { Measurement } from '../types'

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
      <div className="bg-white rounded-xl p-8 text-center glow-coral">
        <div className="mb-2" aria-hidden><Icon name="help" size={40} /></div>
        <p className="font-bold text-coral-dark mb-4">{error}</p>
        <Link to="/" className="btn btn-teal">На главную</Link>
      </div>
    )
  }
  if (!m) return <div aria-busy><SkeletonCard lines={4} /></div>

  const a = m.analysis!
  const green = a.risk_level === 'green'

  return (
    <div className="flex flex-col gap-6 stagger">
      <Confetti fire={green} />

      {/* Hero */}
      <PageHeader
        eyebrow="Результат анализа"
        title="Разбор замера"
        sub={`Анализ от ${a.created_at.slice(0, 16)}`}
        actions={
          <>
            <RiskBadge level={a.risk_level} big />
            <Link to="/new" className="btn btn-gold"><Icon name="pressure" size={16} /> Новый замер</Link>
          </>
        }
      />

      {/* Срочный флаг */}
      {a.findings.some((f) => f.status === 'alarm') && (
        <div className="flip-card flip-card--danger">
          <div className="font-extrabold text-coral-dark mb-1 flex items-center gap-2">
            <Icon name="warning" size={20} /> Обратитесь к врачу
          </div>
          <p className="text-sm text-teal-dark/85">
            Есть тревожные показатели. Не ждите ухудшения — запишитесь к терапевту
            или позвоните в клинику: <span className="font-extrabold">{user?.branch?.phone || brand.phone}</span>.
            При критических значениях вызывайте 103.
          </p>
        </div>
      )}

      {/* Показатели по карточкам */}
      <section>
        <div className="section-title mb-3">
          <span className="emoji-box"><Icon name="pulse" size={20} /></span> Ваши показатели
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {a.findings.map((f) => (
            <IndicatorCard key={f.key} finding={f} />
          ))}
        </div>
      </section>

      {/* Комментарий врача (если оставил в кабинете) */}
      {a.notes && a.notes.length > 0 && (
        <section>
          <div className="section-title mb-3">
            <span className="emoji-box"><Icon name="stethoscope" size={20} /></span> Комментарий врача
          </div>
          <div className="flex flex-col gap-2">
            {a.notes.map((n) => (
              <div key={n.id} className="flip-card flip-card--gold">
                <div className="text-xs font-extrabold text-teal-dark/60 flex items-center gap-1.5">
                  <AvatarDoctor size={20} /> {n.doctor_name} · {n.created_at.slice(0, 16)}
                </div>
                <p className="text-sm text-teal-dark/90 mt-1">{n.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ИИ-блок: текст от LLM или честный fallback */}
      <section>
        <div className="section-title mb-3">
          <span className="emoji-box"><Icon name="robot" size={20} /></span> Рекомендации ИИ
        </div>

        {a.llm_summary ? (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-teal-dark/50 font-bold px-1">
              Рекомендации сгенерированы нейросетью DeepSeek; для этого показатели
              передаются внешнему провайдеру (хранение данных в РФ).
            </p>
            <div className="flip-card flip-card--gold">
              <p className="text-sm text-teal-dark/90 leading-relaxed">{a.llm_summary}</p>
            </div>
            <div className="bg-white rounded-xl p-4 glow-soft">
              <ul className="flex flex-col gap-2">
                {a.llm_items!.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-teal-dark/90">
                    <span className="emoji-box !w-6 !h-6" aria-hidden><Icon name={(['bulb', 'run', 'water', 'salad', 'sleep', 'clock'] as IconName[])[i % 6]} size={12} /></span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="badge badge-sky normal-case tracking-normal w-fit">
              <Icon name="lock" size={12} className="inline-block align-[-1px] mr-1" />ИИ-текст недоступен — показаны рекомендации на основе медицинских норм
            </div>
            <div className="bg-white rounded-xl p-4 glow-soft">
              <ul className="flex flex-col gap-2">
                {a.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-sm text-teal-dark/90">
                    <span className="emoji-box !w-6 !h-6" aria-hidden><Icon name={(['bulb', 'run', 'water', 'salad', 'sleep', 'clock'] as IconName[])[i % 6]} size={12} /></span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <Disclaimer urgent={a.risk_level === 'red'} phone={user?.branch?.phone} />

      <p className="text-center text-xs text-teal-dark/50 font-bold">
        Источник анализа: {a.source === 'rules+llm' ? 'база правил + языковая модель' : 'база правил'} · история — во вкладке «История»
      </p>
    </div>
  )
}
