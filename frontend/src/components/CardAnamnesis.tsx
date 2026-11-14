// Общие блоки анкеты-анамнеза: используются пациентом (MedCard) и врачом (карточка пациента).
import { SURVEY_SHORT, ALARM_KEYS } from './AnamnesisSurvey'
import type { MedCard } from '../types'

export interface CardFormState {
  blood_type: string
  allergies: string
  chronic: string
  medications: string
  surgeries: string
  smoking: string
  alcohol: string
  activity: string
}

export function defaultCardForm(card: MedCard): CardFormState {
  return {
    blood_type: card.blood_type,
    allergies: card.allergies,
    chronic: card.chronic,
    medications: card.medications,
    surgeries: card.surgeries,
    smoking: card.smoking,
    alcohol: card.alcohol,
    activity: card.activity,
  }
}

const HABIT_GROUPS: Array<{ key: keyof CardFormState; label: string; options: string[] }> = [
  { key: 'smoking', label: 'Курение', options: ['нет', 'бросил', 'курирует'] },
  { key: 'alcohol', label: 'Алкоголь', options: ['нет', 'редко', 'регулярно'] },
  { key: 'activity', label: 'Физическая активность', options: ['низкая', 'средняя', 'высокая'] },
]

function toggleClass(active: boolean): string {
  return `btn btn-sm flex-1 ${active ? 'btn-teal' : 'btn-ghost'}`
}

export function CardFormFields({ form, setField }: {
  form: CardFormState
  setField: (key: keyof CardFormState, value: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="flip-label" htmlFor="mc-blood">Группа крови</label>
          <input id="mc-blood" className="flip-input" placeholder="например, A(II) Rh+"
                 maxLength={16} value={form.blood_type} onChange={(e) => setField('blood_type', e.target.value)} />
        </div>
        <div>
          <label className="flip-label" htmlFor="mc-surgeries">Операции, госпитализации</label>
          <input id="mc-surgeries" className="flip-input" placeholder="что и когда"
                 maxLength={1000} value={form.surgeries} onChange={(e) => setField('surgeries', e.target.value)} />
        </div>
      </div>

      <div>
        <label className="flip-label" htmlFor="mc-allergies">Аллергии</label>
        <textarea id="mc-allergies" className="flip-input min-h-[56px]" maxLength={1000}
                  placeholder="особенно лекарственные — это важно перед процедурами"
                  value={form.allergies} onChange={(e) => setField('allergies', e.target.value)} />
      </div>
      <div>
        <label className="flip-label" htmlFor="mc-chronic">Хронические заболевания</label>
        <textarea id="mc-chronic" className="flip-input min-h-[56px]" maxLength={1000}
                  placeholder="диагнозы, которые у вас уже есть"
                  value={form.chronic} onChange={(e) => setField('chronic', e.target.value)} />
      </div>
      <div>
        <label className="flip-label" htmlFor="mc-medications">Постоянные лекарства</label>
        <textarea id="mc-medications" className="flip-input min-h-[56px]" maxLength={1000}
                  placeholder="название, доза, когда принимаете"
                  value={form.medications} onChange={(e) => setField('medications', e.target.value)} />
      </div>

      {HABIT_GROUPS.map((group) => (
        <div key={group.key}>
          <label className="flip-label">{group.label}</label>
          <div className="flex gap-2">
            {group.options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setField(group.key, form[group.key] === option ? '' : option)}
                className={toggleClass(form[group.key] === option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Просмотр анкеты без редактирования (врач, вкладка «Медкарта»)
const VIEW_FIELDS: Array<{ key: keyof CardFormState; label: string }> = [
  { key: 'blood_type', label: 'Группа крови' },
  { key: 'allergies', label: 'Аллергии' },
  { key: 'chronic', label: 'Хронические заболевания' },
  { key: 'medications', label: 'Постоянные лекарства' },
  { key: 'surgeries', label: 'Операции, госпитализации' },
  { key: 'smoking', label: 'Курение' },
  { key: 'alcohol', label: 'Алкоголь' },
  { key: 'activity', label: 'Физическая активность' },
]

// Заполненность анкеты: прогресс-бар + чего не хватает (идея Сбер Здоровья)
export function CardCompleteness({ card, compact }: { card: MedCard; compact?: boolean }) {
  const filled = VIEW_FIELDS.filter((f) => card[f.key].trim())
  const missing = VIEW_FIELDS.filter((f) => !card[f.key].trim())
  const percent = Math.round((filled.length / VIEW_FIELDS.length) * 100)
  const done = percent === 100
  return (
    <div className={compact ? '' : 'mb-4'}>
      <div className="flex items-center justify-between text-xs font-extrabold mb-1.5">
        <span className={done ? 'text-teal' : 'text-teal-dark/70'}>
          {done ? 'Анкета заполнена полностью' : `Заполнено ${percent}%`}
        </span>
        <span className="text-teal-dark/45">{filled.length} из {VIEW_FIELDS.length} разделов</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#e5e7eb] overflow-hidden">
        <div
          className="h-full rounded-full transition-quick"
          style={{ width: `${Math.max(percent, 4)}%`, background: done ? 'var(--color-teal)' : '#c99700' }}
        />
      </div>
      {!done && !compact && missing.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className="text-[11px] font-bold text-teal-dark/45 leading-5">не заполнено:</span>
          {missing.map((f) => (
            <span key={f.key} className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#e9f7f6] text-teal-dark/70">
              {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export function CardView({ card }: { card: MedCard }) {
  const filled = VIEW_FIELDS.filter((f) => card[f.key])

  // Тревожные ответы опросника Минздрава — врачу первым делом
  let surveyAlarm: string[] = []
  let surveyAudit = 0
  let surveyOther = ''
  if (card.survey) {
    try {
      const s = JSON.parse(card.survey) as Record<string, unknown>
      surveyAlarm = Array.from(ALARM_KEYS).filter((k) => s[k] === true).map((k) => SURVEY_SHORT[k] ?? k)
      surveyAudit = (Number(s.alcohol_freq) || 0) + (Number(s.alcohol_portions) || 0) + (Number(s.alcohol_binge) || 0)
      surveyOther = String(s.other_complaints ?? '').trim()
    } catch { /* повреждённый JSON — блок пропускается */ }
  }

  return (
    <div className="flex flex-col gap-3">
      <CardCompleteness card={card} />
      {surveyAlarm.length > 0 && (
        <div className="rounded-xl border border-coral/40 bg-[#dc262608] p-3.5">
          <div className="text-xs font-extrabold uppercase tracking-[1px] text-coral-dark mb-2">
            Опросник МЗ · требуют осмотра врача
          </div>
          <div className="flex flex-wrap gap-1.5">
            {surveyAlarm.map((label) => (
              <span key={label} className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#dc262614] text-coral-dark">
                {label}
              </span>
            ))}
          </div>
          {surveyAudit >= 6 && (
            <div className="text-xs font-bold text-teal-dark/70 mt-2">AUDIT-C: {surveyAudit} баллов — риск пагубного потребления алкоголя</div>
          )}
          {surveyOther && (
            <div className="text-xs font-bold text-teal-dark/70 mt-2">Другие жалобы: {surveyOther}</div>
          )}
        </div>
      )}
      {filled.length === 0 ? (
        <div className="text-sm font-bold text-teal-dark/55">
          Пациент ещё не вводил анамнез — попросите заполнить анкету в его кабинете.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-x-10 gap-y-3">
          {filled.map((f) => (
            <div key={f.key} className="border-b border-[#e5e7eb] pb-2">
              <div className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-teal-dark/45">{f.label}</div>
              <div className="text-sm font-bold text-teal-dark whitespace-pre-wrap mt-0.5">{card[f.key]}</div>
            </div>
          ))}
        </div>
      )}
      {card.updated_at && (
        <div className="text-xs font-bold text-teal-dark/50">
          {card.updated_by === 'doctor' ? 'Анкету дополнял врач' : 'Анкету заполнял пациент'} · {card.updated_at.slice(0, 10)}
        </div>
      )}
    </div>
  )
}
