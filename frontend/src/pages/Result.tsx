import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../api'
import RiskBadge from '../components/RiskBadge'
import IndicatorCard from '../components/IndicatorCard'
import Disclaimer from '../components/Disclaimer'
import Confetti from '../components/Confetti'
import { Icon } from '../components/Icon'
import type { Measurement } from '../types'

export default function Result() {
  const { id } = useParams()
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
        <div className="text-4xl mb-2" aria-hidden>🤔</div>
        <p className="font-bold text-coral-dark mb-4">{error}</p>
        <Link to="/" className="btn btn-teal">На главную</Link>
      </div>
    )
  }
  if (!m) return <div className="text-center font-extrabold text-teal-dark animate-pulse">Загрузка…</div>

  const a = m.analysis!
  const green = a.risk_level === 'green'

  return (
    <div className="flex flex-col gap-6">
      <Confetti fire={green} />

      {/* Hero */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Результат анализа</div>
          <h1 className="text-4xl mt-1.5" style={{ fontSize: 36 }}>Разбор замера</h1>
          <p className="text-sm text-teal-dark/60 mt-1.5">Анализ от {a.created_at.slice(0, 16)}</p>
        </div>
        <div className="flex items-center gap-3">
          <RiskBadge level={a.risk_level} big />
          <Link to="/new" className="btn btn-gold">+ Новый замер</Link>
        </div>
      </div>

      {/* Срочный флаг */}
      {a.findings.some((f) => f.status === 'alarm') && (
        <div className="flip-card flip-card--danger">
          <div className="font-extrabold text-coral-dark mb-1 flex items-center gap-2">
            <Icon name="warning" size={20} /> Обратитесь к врачу
          </div>
          <p className="text-sm text-teal-dark/85">
            Есть тревожные показатели. Не ждите ухудшения — запишитесь к терапевту,
            при критических значениях вызывайте 103.
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

      {/* ИИ-блок: текст от LLM или честный fallback */}
      <section>
        <div className="section-title mb-3">
          <span className="emoji-box"><Icon name="robot" size={20} /></span> Рекомендации ИИ
        </div>

        {a.llm_summary ? (
          <div className="flex flex-col gap-3">
            <div className="flip-card flip-card--gold">
              <p className="text-sm text-teal-dark/90 leading-relaxed">{a.llm_summary}</p>
            </div>
            <div className="bg-white rounded-xl p-4 glow-soft">
              <ul className="flex flex-col gap-2">
                {a.llm_items!.map((item, i) => (
                  <li key={i} className="flex gap-2 text-sm text-teal-dark/90">
                    <span className="emoji-box !w-6 !h-6 text-xs" aria-hidden>{['💡', '🏃', '💧', '🥗', '😴', '⏰'][i % 6]}</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="badge badge-sky normal-case tracking-normal w-fit">
              🔒 ИИ-текст недоступен — показаны рекомендации на основе медицинских норм
            </div>
            <div className="bg-white rounded-xl p-4 glow-soft">
              <ul className="flex flex-col gap-2">
                {a.recommendations.map((rec, i) => (
                  <li key={i} className="flex gap-2 text-sm text-teal-dark/90">
                    <span className="emoji-box !w-6 !h-6 text-xs" aria-hidden>{['💡', '🏃', '💧', '🥗', '😴', '⏰'][i % 6]}</span>
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>

      <Disclaimer urgent={a.risk_level === 'red'} />

      <p className="text-center text-xs text-teal-dark/50 font-bold">
        Источник анализа: {a.source === 'rules+llm' ? 'база правил + языковая модель' : 'база правил'} · история — во вкладке «История»
      </p>
    </div>
  )
}
