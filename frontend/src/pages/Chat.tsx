// Чат с ИИ-ассистентом: DeepSeek через PlusVibe с инструментами над данными пользователя.
import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import EmptyArt from '../components/EmptyArt'
import PageHeader from '../components/PageHeader'
import { Skeleton } from '../components/Skeleton'
import type { ChatMessage } from '../types'

const PATIENT_CHIPS = [
  'Как моё давление за последние замеры?',
  'Что показывает последний разбор?',
  'Как я сплю и сколько хожу в среднем за месяц?',
  'Был ли у меня красный риск?',
  'Объясни мои последние анализы',
]
const DOCTOR_CHIPS = [
  'Покажи пациентов, требующих внимания',
  'Сколько пациентов в моём филиале?',
  'Какие риски у моих пациентов?',
  'Что в анализах пациента?',
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
          j % 2 === 1 ? <strong key={j} className="font-medium">{seg}</strong> : seg,
        );
        return (
          <div key={i} className={bullet ? "flex gap-2 items-start" : ""}>
            {bullet && <span className="text-ink-soft" aria-hidden>•</span>}
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
  const [historyLoading, setHistoryLoading] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)

  function loadHistory() {
    setHistoryLoading(true)
    setError('')
    api.fetchChatHistory()
      .then((d) => setItems(d.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить историю'))
      .finally(() => setHistoryLoading(false))
  }

  useEffect(() => {
    loadHistory()
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
      setInput(message)
      setError(err instanceof Error ? err.message : 'Ошибка чата')
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    if (busy || !window.confirm('Очистить всю переписку с ИИ?')) return
    setError('')
    setBusy(true)
    try {
      await api.clearChat()
      setItems([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось очистить переписку')
    } finally {
      setBusy(false)
    }
  }

  const chips = user?.role === 'doctor' ? DOCTOR_CHIPS : PATIENT_CHIPS

  return (
    <div className="flex flex-col gap-4 w-full max-w-3xl mx-auto h-[calc(100dvh-150px)] sm:h-auto sm:min-h-[520px]">
      <div className="shrink-0">
        <PageHeader
          eyebrow="Помощник по вашим данным"
          title="Ассистент"
          actions={
            items.length > 0 ? (
              <button className="btn btn-ghost btn-sm" onClick={clear} disabled={busy}>
                <Icon name="trash" size={13} /> Очистить
              </button>
            ) : undefined
          }
        />
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-soft max-w-[74ch] shrink-0">
        Ассистент видит {user?.role === 'doctor' ? 'данные пациентов вашего филиала' : 'ваши замеры и разборы'}.
        Диагнозов не ставит. Не вводите ФИО, адреса и номера документов: текст уходит
        внешней модели, контакты вырезаются автоматически.
      </p>

      {/* Лента сообщений */}
      <div
        ref={boxRef}
        className="flex-1 min-h-0 flex flex-col gap-4 border border-line bg-white rounded-lg p-4 sm:max-h-[54vh] overflow-y-auto"
      >
        {historyLoading && (
          <div className="flex flex-col gap-3 py-2" aria-busy>
            <Skeleton w="30%" h={11} />
            <Skeleton w="68%" h={34} r={6} />
            <Skeleton w="52%" h={34} r={6} className="ml-auto" />
          </div>
        )}

        {!historyLoading && items.length === 0 && error && (
          <div className="grid place-items-center py-8 text-center">
            <div className="text-[12.5px] text-coral-dark mb-3" role="alert">{error}</div>
            <button className="btn btn-ghost" onClick={loadHistory}>Повторить</button>
          </div>
        )}

        {!historyLoading && items.length === 0 && !error && (
          <div className="grid place-items-center py-8 text-center">
            <EmptyArt className="mx-auto mb-3 opacity-70" />
            <p className="text-[13.5px] font-medium text-ink">Переписки пока нет</p>
            <p className="text-[12.5px] text-ink-soft max-w-[44ch] mt-1.5 leading-relaxed">
              Спросите о показателях — ассистент сам поднимет нужные замеры, разборы
              и текст распознанных анализов.
            </p>
          </div>
        )}

        {items.map((m) => (
          <div key={m.id} className={`flex items-start gap-2.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
            {m.role === 'assistant' && <span className="ai-avatar mt-0.5"><Icon name="sparkle" size={14} /></span>}
            <div
              className={`max-w-[85%] px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                m.role === 'user'
                  ? 'chat-bubble-user text-white'
                  : 'chat-bubble-ai text-ink'
              }`}
            >
              <Md text={m.content} />
              <div className={`mt-1.5 text-[10.5px] tabular-nums ${m.role === 'user' ? 'text-white/70' : 'text-ink-soft'}`}>
                {m.created_at.slice(5, 16)}
              </div>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-start gap-2.5" aria-busy="true" aria-live="polite">
            <span className="ai-avatar ai-avatar--pulsing"><Icon name="sparkle" size={14} /></span>
            <div className="chat-bubble-ai px-3.5 py-3 flex items-center gap-1.5">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="ml-2 text-[11.5px] text-ink-soft">Смотрит данные…</span>
            </div>
          </div>
        )}
      </div>

      {error && items.length > 0 && (
        <div className="text-[12.5px] text-coral-dark" role="alert" aria-live="polite">{error}</div>
      )}

      {/* Подсказки */}
      <div className="shrink-0 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible">
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

      {/* Ввод */}
      <div className="chat-dock shrink-0 sticky bottom-[74px] z-20 -mx-4 px-4 sm:static sm:mx-0 sm:px-0">
        <form
          className="composer-card flex items-end gap-1.5"
          aria-busy={busy}
          onSubmit={(e) => { e.preventDefault(); send(input) }}
        >
          <textarea
            className="flip-input flex-1 resize-none"
            aria-label="Сообщение ассистенту"
            rows={1}
            placeholder="Спросите о показателях или анализах…"
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
          <button
            className="btn btn-gold shrink-0"
            aria-label="Отправить сообщение"
            aria-busy={busy}
            disabled={busy || !input.trim()}
          >
            <Icon name="send" size={15} />
          </button>
        </form>
      </div>
    </div>
  )
}
