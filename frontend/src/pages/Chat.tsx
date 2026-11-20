// Чат с ИИ-ассистентом: DeepSeek через PlusVibe с инструментами над данными пользователя.
import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import EmptyArt from '../components/EmptyArt'
import PageHeader from '../components/PageHeader'
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


// Безопасный рендер markdown-ответа модели (только жирный и пункты;
// React экранирует текст — XSS от содержимого модели исключён).
function Md({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        if (line.trim() === "") return <div key={i} className="h-2" />;
        const bullet = /^-\s/.test(line);
        const clean = line.replace(/^\s*-\s/, "");
        const parts = clean.split(/\*\*([^*]+)\*\*/g);
        const body = parts.map((seg, j) =>
          j % 2 === 1 ? <strong key={j}>{seg}</strong> : seg,
        );
        return (
          <div key={i} className={bullet ? "flex gap-2 items-start" : ""}>
            {bullet && <span className="opacity-50" aria-hidden>•</span>}
            <span>{body}</span>
          </div>
        );
      })}
    </>
  );
}

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
    <div className="flex flex-col gap-3 sm:gap-4 w-full max-w-3xl mx-auto h-[calc(100dvh-170px)] sm:h-auto sm:min-h-[480px] stagger">
      <div className="shrink-0">
        <PageHeader
          title={<>Ассистент <Icon name="sparkle" size={20} className="inline-block align-[-2px] text-teal" /></>}
          actions={
            <button className="btn btn-ghost btn-sm" onClick={clear}>
              <Icon name="trash" size={14} /> Очистить
            </button>
          }
        />
      </div>

      <p className="text-sm text-teal-dark/80 -mt-3 hidden sm:block shrink-0">
        Ассистент видит {user?.role === 'doctor'
          ? 'данные пациентов вашего филиала'
          : 'ваши замеры и разборы'} и отвечает с опорой на них.
        Не ставит диагнозы. При тревожных показателях обратитесь к врачу.
      </p>
      <p className="text-xs text-teal-dark/75 -mt-4 sm:hidden shrink-0">
        Ассистент видит ваши данные и не ставит диагнозы.
      </p>

      {/* Лента сообщений */}
      <div
        ref={boxRef}
        className="flex-1 min-h-0 flex flex-col gap-3 rounded-2xl border border-[#eef3f2] bg-white p-3 sm:p-4 sm:max-h-[58vh] overflow-y-auto shadow-soft [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.length === 0 && (
          <div className="grid place-items-center py-8 text-center">
            <EmptyArt className="mx-auto mb-2" />
            <p className="text-base font-bold text-[#1b2622]">Пока нет сообщений</p>
            <p className="text-sm text-teal-dark/60 max-w-sm mt-1">
              Задайте вопрос о показателях. Ассистент сам посмотрит нужные замеры
              и разборы через инструменты.
            </p>
          </div>
        )}
        {items.map((m) => (
          <div key={m.id} className={`flex items-start gap-2 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'assistant' && <span className="ai-avatar mt-0.5"><Icon name="sparkle" size={15} /></span>}
            <div
              className={`max-w-[85%] px-4 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'chat-bubble-user text-white'
                  : 'chat-bubble-ai text-[#2c3e3b]'
              }`}
            >
              <Md text={m.content} />
              <div className={`mt-1 text-[10px] font-bold ${m.role === 'user' ? 'text-white/60' : 'text-teal-dark/45'}`}>
                {m.created_at.slice(5, 16)}
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-start gap-2">
            <span className="ai-avatar ai-avatar--pulsing"><Icon name="sparkle" size={15} /></span>
            <div className="chat-bubble-ai px-4 py-3 flex items-center gap-1.5">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="ml-1.5 text-xs font-bold text-teal-dark/55">ИИ смотрит данные…</span>
            </div>
          </div>
        )}
      </div>

      {error && <div className="badge badge-red w-fit normal-case tracking-normal">{error}</div>}

      {/* Подсказки */}
      <div className="shrink-0 flex gap-2 -mt-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
        {chips.map((c) => (
          <button
            key={c}
            className="chip-btn whitespace-nowrap shrink-0 sm:shrink"
            onClick={() => send(c)}
            disabled={busy}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Ввод: на телефоне прилипает над таб-баром с плавной белой подложкой */}
      <div className="chat-dock shrink-0 sticky bottom-[82px] z-20 -mx-4 px-4 sm:static sm:mx-0 sm:px-0">
      <form
        className="composer-card flex items-end gap-1.5"
        onSubmit={(e) => { e.preventDefault(); send(input) }}
      >
        <textarea
          className="flip-input flex-1 resize-none"
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
        <button className="btn btn-gold shrink-0 !min-h-[36px] !px-3.5" disabled={busy || !input.trim()}>
          <Icon name="send" size={16} />
          <span className="hidden sm:inline">Отправить</span>
        </button>
      </form>
      </div>
    </div>
  )
}
