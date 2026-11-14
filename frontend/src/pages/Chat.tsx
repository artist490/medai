// Чат с ИИ-ассистентом: DeepSeek через PlusVibe с инструментами над данными пользователя.
import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import type { ChatMessage } from '../types'

const TOOL_LABELS: Record<string, string> = {
  get_profile: 'профиль',
  get_recent_measurements: 'последние замеры',
  get_last_analysis: 'последний разбор',
  get_stats_summary: 'статистика за период',
  get_risk_history: 'история рисков',
  get_patients_overview: 'обзор пациентов',
  get_patient_measurements: 'замеры пациента',
  get_patient_last_analysis: 'разбор пациента',
}

const PATIENT_CHIPS = [
  'Как моё давление за последние замеры?',
  'Что показывает последний разбор?',
  'Как я сплю и сколько хожу в среднем за месяц?',
  'Был ли у меня красный риск?',
]
const DOCTOR_CHIPS = [
  'Покажи пациентов, требующих внимания',
  'Сколько пациентов в моём филиале?',
  'Какие риски у моих пациентов?',
]

export default function Chat() {
  const { user } = useAuth()
  const [items, setItems] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.fetchChatHistory()
      .then((d) => setItems(d.items))
      .catch(() => {})
  }, [])

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: 'smooth' })
  }, [items, busy])

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    setError('')
    setBusy(true)
    setInput('')
    // мгновенно показываем сообщение пользователя
    setItems((prev) => [...prev, {
      id: Date.now(), role: 'user', content: message,
      created_at: new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
    }])
    try {
      const reply = await api.sendChat(message)
      setItems((prev) => [...prev, {
        id: Date.now() + 1, role: 'assistant', content: reply.reply,
        created_at: new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }),
      }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка чата')
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    if (!window.confirm('Очистить всю переписку с ИИ?')) return
    await api.clearChat().catch(() => {})
    setItems([])
  }

  const chips = user?.role === 'doctor' ? DOCTOR_CHIPS : PATIENT_CHIPS

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">ИИ-ассистент клиники</div>
          <h1 className="mt-1.5" style={{ fontSize: 32, letterSpacing: '-0.5px' }}>
            Чат с ИИ <Icon name="robot" size={26} className="inline-block align-[-4px]" />
          </h1>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={clear}>
          <Icon name="trash" size={14} /> Очистить
        </button>
      </div>

      <p className="text-sm text-teal-dark/60 -mt-3">
        Ассистент видит {user?.role === 'doctor'
          ? 'данные пациентов вашего филиала'
          : 'ваши замеры и разборы'} и отвечает с опорой на них.
        Не ставит диагнозы — при тревожных показателях обратитесь к врачу.
      </p>

      {/* Лента сообщений */}
      <div
        ref={boxRef}
        className="flex flex-col gap-3 rounded-2xl border border-[#e8eeed] bg-white p-4 max-h-[58vh] overflow-y-auto"
      >
        {items.length === 0 && (
          <div className="grid place-items-center py-8 text-center">
            <span className="icon-tile icon-tile--teal mb-2"><Icon name="robot" size={26} /></span>
            <p className="text-sm text-teal-dark/60 max-w-sm">
              Задайте вопрос о показателях — ассистент сам посмотрит нужные замеры
              и разборы через инструменты.
            </p>
          </div>
        )}
        {items.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'self-end bg-teal-dark text-white'
                : 'self-start bg-[#f4f8f7] border border-[#e6eeec] text-[#2c3e3b]'
            }`}
          >
            {m.content}
            <div className={`mt-1 text-[10px] font-bold ${m.role === 'user' ? 'text-white/60' : 'text-teal-dark/45'}`}>
              {m.created_at.slice(5, 16)}
            </div>
          </div>
        ))}
        {busy && (
          <div className="self-start flex items-center gap-2 text-xs font-bold text-teal-dark/60 bg-[#f4f8f7] border border-[#e6eeec] rounded-xl px-4 py-2.5">
            <span className="animate-pulse"><Icon name="robot" size={16} /></span>
            ИИ смотрит данные…
          </div>
        )}
      </div>

      {error && <div className="badge badge-red w-fit normal-case tracking-normal">{error}</div>}

      {/* Подсказки */}
      <div className="flex flex-wrap gap-2 -mt-2">
        {chips.map((c) => (
          <button
            key={c}
            className="badge badge-teal normal-case tracking-normal hover:bg-[#e2f0ef] transition-quick"
            onClick={() => send(c)}
            disabled={busy}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Ввод */}
      <form
        className="flex gap-2 items-end"
        onSubmit={(e) => { e.preventDefault(); send(input) }}
      >
        <textarea
          className="flip-input min-h-[44px] flex-1 resize-none"
          rows={1}
          placeholder="Спросите о своих показателях…"
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
        />
        <button className="btn btn-gold" disabled={busy || !input.trim()}>
          <Icon name="rocket" size={16} /> Отправить
        </button>
      </form>
    </div>
  )
}
