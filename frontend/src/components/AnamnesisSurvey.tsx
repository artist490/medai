// Опросник анамнеза по приказу Минздрава № 404н (анкета ХНИЗ, НМИЦ профмедицины):
// механика — пошаговые экраны с прогресс-баром (как у Сбер Здоровья),
// контент — официальные вопросы, сокращённые для приложения.
// Результат — JSON в patient_cards.survey + человекочитаемый chronic.
import { useMemo, useState } from 'react'

export type SurveyAnswers = Record<string, boolean | number | string>

const STEP_TOTAL = 6

// Короткие лейблы для чипсов риск-профиля и текста chronic
export const SURVEY_SHORT: Record<string, string> = {
  dx_hypertension: 'гипертония',
  dx_chd: 'ИБС',
  dx_cvd: 'сосуды мозга',
  dx_lung: 'хроническая болезнь лёгких',
  dx_tb: 'туберкулёз',
  dx_diabetes: 'диабет',
  dx_stomach: 'гастрит/язва',
  dx_kidney: 'болезнь почек',
  dx_cancer: 'онкодиагноз',
  dx_cholesterol: 'повышенный холестерин',
  hx_mi_self: 'инфаркт в анамнезе',
  hx_stroke_self: 'инсульт в анамнезе',
  hx_mi_stroke_family: 'инфаркт/инсульт у родственников',
  hx_cancer_family: 'онкология у родственников',
  sym_chest_pain: 'грудные боли при нагрузке',
  sym_sudden_weakness: 'внезапная слабость в конечности',
  sym_sudden_numbness: 'внезапное онемение',
  sym_vision_loss: 'эпизод потери зрения',
  sym_chronic_cough: 'хронический кашель с мокротой',
  sym_wheezing: 'хрипы в груди',
  sym_hemoptysis: 'кровохарканье',
  sym_epigastric: 'боли в верхней части живота',
  sym_black_stool: 'чёрный дегтеобразный стул',
  sym_weight_loss: 'похудение без причины',
  sym_rectal_pain: 'боль в заднем проходе',
  sym_blood_in_stool: 'кровь в стуле',
  smoking_now: 'курит',
  walking_30min: 'ходьба ≥30 мин/день',
  vegetables_daily: 'овощи/фрукты ежедневно',
  salting: 'подсаливает пищу',
}

// Тревожные симптомы: «Да» обязывает показать врача (скрининг ХНИЗ).
// F007: живой список приходит из API (GET /api/medcard → alarm_keys, источник —
// signals.ALARM_SURVEY_KEYS на бэке); этот Set — только fallback, когда API недоступен.
export const ALARM_KEYS = new Set([
  'sym_chest_pain', 'sym_sudden_weakness', 'sym_sudden_numbness', 'sym_vision_loss',
  'sym_hemoptysis', 'sym_black_stool', 'sym_blood_in_stool', 'sym_weight_loss',
])

const DX_ITEMS: Array<{ key: string; label: string; rx?: string; extra?: { key: string; label: string } }> = [
  { key: 'dx_hypertension', label: 'Гипертоническая болезнь (повышенное давление)', rx: 'dx_hypertension_rx' },
  { key: 'dx_chd', label: 'Ишемическая болезнь сердца (стенокардия)' },
  { key: 'dx_cvd', label: 'Заболевание сосудов головного мозга' },
  { key: 'dx_lung', label: 'Хроническая болезнь бронхов или лёгких (бронхит, эмфизема, астма)' },
  { key: 'dx_tb', label: 'Туберкулёз' },
  { key: 'dx_diabetes', label: 'Сахарный диабет или повышенный сахар', rx: 'dx_diabetes_rx' },
  { key: 'dx_stomach', label: 'Заболевание желудка (гастрит, язва)' },
  { key: 'dx_kidney', label: 'Хроническая болезнь почек' },
  { key: 'dx_cancer', label: 'Злокачественное новообразование', extra: { key: 'dx_cancer_type', label: 'Какое именно' } },
  { key: 'dx_cholesterol', label: 'Повышенный уровень холестерина', rx: 'dx_cholesterol_rx' },
]

const HX_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'hx_mi_self', label: 'Был ли у Вас инфаркт миокарда?' },
  { key: 'hx_stroke_self', label: 'Был ли у Вас инсульт?' },
  { key: 'hx_mi_stroke_family', label: 'Инфаркт или инсульт у близких родственников в молодом/среднем возрасте (до 65 у матери или сестёр, до 55 у отца или братьев)?' },
  { key: 'hx_cancer_family', label: 'Онкозаболевания у близких родственников в молодом/среднем возрасте?' },
]

const CARDIO_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'sym_chest_pain', label: 'Поднимаясь по лестнице или в гору, спеша или выходя на холод из тёплого помещения — бывает ли боль, давление, жжение за грудиной или в левой руке?' },
  { key: 'sym_chest_pain_relieves', label: 'Если да — проходит ли это в покое в течение ≤20 минут или за 1–5 минут после нитроглицерина?' },
  { key: 'sym_sudden_weakness', label: 'Бывала ли внезапная кратковременная слабость в руке или ноге — так, что не могли взять предмет или пройтись?' },
  { key: 'sym_sudden_numbness', label: 'Бывало ли внезапное кратковременное онемение в руке, ноге или половине лица?' },
  { key: 'sym_vision_loss', label: 'Бывала ли внезапная кратковременная потеря зрения на один глаз?' },
]

const LUNG_GI_ITEMS: Array<{ key: string; label: string }> = [
  { key: 'sym_chronic_cough', label: 'Бывают ли ежегодно периоды ежедневного кашля с мокротой ~3 месяца в году?' },
  { key: 'sym_wheezing', label: 'Бывают ли свистящие хрипы в груди, не проходящие при откашливании?' },
  { key: 'sym_hemoptysis', label: 'Бывало ли когда-либо кровохарканье?' },
  { key: 'sym_epigastric', label: 'Беспокоят ли боли в верхней части живота, отрыжка, тошнота, ухудшение аппетита?' },
  { key: 'sym_black_stool', label: 'Бывает ли неоформленный чёрный или дегтеобразный стул?' },
  { key: 'sym_weight_loss', label: 'Похудели ли Вы недавно без диеты и увеличения нагрузок?' },
  { key: 'sym_rectal_pain', label: 'Бывает ли боль в области заднепроходного отверстия?' },
  { key: 'sym_blood_in_stool', label: 'Бывают ли кровяные выделения с калом?' },
]

const AUDIT_FREQ = ['Никогда', 'Раз в месяц и реже', '2–4 раза в месяц', '2–3 раза в неделю', '≥4 раз в неделю']
const AUDIT_PORTIONS = ['1–2 порции', '3–4 порции', '5–6 порций', '7–9 порций', '≥10 порций']

function YesNo({ value, onChange }: { value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      {[true, false].map((v) => (
        <button key={String(v)} type="button" onClick={() => onChange(v)}
                className={`btn btn-sm flex-1 ${value === v ? 'btn-gold' : 'btn-ghost'}`}>
          {v ? 'Да' : 'Нет'}
        </button>
      ))}
    </div>
  )
}

// ---------- Шаги ----------

function DiagnosesStep({ a, set }: { a: SurveyAnswers; set: (k: string, v: boolean | number | string) => void }) {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-sm font-bold text-ink-soft">Говорил ли Вам когда-либо врач, что у Вас имеется:</p>
      {DX_ITEMS.map((item) => {
        const checked = a[item.key] === true
        return (
          <div key={item.key} className={`rounded-xl border p-3.5 transition-quick ${checked ? 'border-teal bg-teal-bg/50' : 'border-[#e5e7eb]'}`}>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={checked} onChange={(e) => set(item.key, e.target.checked)}
                     className="mt-0.5 w-5 h-5 accent-[#00b8a9] cursor-pointer" />
              <span className="text-sm font-bold text-teal-dark leading-snug">{item.label}</span>
            </label>
            {checked && item.rx && (
              <div className="mt-2.5 ml-8">
                <div className="text-xs font-extrabold text-ink-soft mb-1.5">Принимаете ли Вы препараты?</div>
                <YesNo value={a[item.rx] as boolean | undefined} onChange={(v) => set(item.rx!, v)} />
              </div>
            )}
            {checked && item.extra && (
              <div className="mt-2.5 ml-8">
                <label className="flip-label" htmlFor={`s-${item.extra.key}`}>{item.extra.label}</label>
                <input id={`s-${item.extra.key}`} className="flip-input" maxLength={200}
                       value={String(a[item.extra.key] ?? '')} onChange={(e) => set(item.extra!.key, e.target.value)} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function YesNoStep({ items, a, set, alarmKeys }: { items: Array<{ key: string; label: string }>; a: SurveyAnswers; set: (k: string, v: boolean | number | string) => void; alarmKeys: Set<string> }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => {
        const alarmYes = alarmKeys.has(item.key) && a[item.key] === true
        return (
          <div key={item.key} className={`rounded-xl border p-3.5 ${alarmYes ? 'border-coral bg-[#dc262608]' : 'border-[#e5e7eb]'}`}>
            <p className="text-sm font-bold text-teal-dark leading-snug mb-2.5">{item.label}</p>
            <YesNo value={a[item.key] as boolean | undefined} onChange={(v) => set(item.key, v)} />
          </div>
        )
      })}
    </div>
  )
}

function HabitsStep({ a, set }: { a: SurveyAnswers; set: (k: string, v: boolean | number | string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-[#e5e7eb] p-3.5">
        <p className="text-sm font-bold text-teal-dark leading-snug mb-2.5">Курите ли Вы (одна и более сигарет в день)?</p>
        <YesNo value={a.smoking_now as boolean | undefined} onChange={(v) => set('smoking_now', v)} />
        {a.smoking_now === true && (
          <div className="mt-2.5">
            <label className="flip-label" htmlFor="s-cig">Сколько сигарет в день в среднем?</label>
            <input id="s-cig" type="number" min={1} max={100} className="flip-input" inputMode="numeric"
                   value={String(a.cigarettes_per_day ?? '')} onChange={(e) => set('cigarettes_per_day', e.target.value)} />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#e5e7eb] p-3.5">
        <p className="text-sm font-bold text-teal-dark leading-snug mb-2.5">Сколько минут в день Вы ходите пешком в умеренном или быстром темпе?</p>
        <div className="flex gap-2">
          {[['less', 'До 30 минут'], ['more', '30 минут и более']].map(([v, label]) => (
            <button key={v} type="button"
                    className={`btn btn-sm flex-1 ${a.walking === v ? 'btn-gold' : 'btn-ghost'}`}
                    onClick={() => set('walking', v)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#e5e7eb] p-3.5">
        <p className="text-sm font-bold text-teal-dark leading-snug mb-2.5">Присутствует ли в ежедневном рационе 400–500 г сырых овощей и фруктов?</p>
        <YesNo value={a.vegetables_daily as boolean | undefined} onChange={(v) => set('vegetables_daily', v)} />
      </div>

      <div className="rounded-xl border border-[#e5e7eb] p-3.5">
        <p className="text-sm font-bold text-teal-dark leading-snug mb-2.5">Есть ли привычка подсаливать приготовленную пищу, не пробуя её?</p>
        <YesNo value={a.salting as boolean | undefined} onChange={(v) => set('salting', v)} />
      </div>

      <div className="rounded-xl border border-[#e5e7eb] p-3.5 flex flex-col gap-3">
        <div className="text-xs font-semibold text-ink-soft">Алкоголь (шкала AUDIT-C)</div>
        <div>
          <div className="text-xs font-bold text-ink-soft mb-1.5">Как часто Вы употребляете алкогольные напитки?</div>
          <div className="flex flex-wrap gap-1.5">
            {AUDIT_FREQ.map((label, score) => (
              <button key={label} type="button"
                      className={`btn btn-sm ${a.alcohol_freq === score ? 'btn-gold' : 'btn-ghost'}`}
                      onClick={() => set('alcohol_freq', score)}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-ink-soft mb-1.5">Сколько порций обычно за один раз? (1 порция = 30 мл крепкого, 100 мл вина, 300 мл пива)</div>
          <div className="flex flex-wrap gap-1.5">
            {AUDIT_PORTIONS.map((label, score) => (
              <button key={label} type="button"
                      className={`btn btn-sm ${a.alcohol_portions === score ? 'btn-gold' : 'btn-ghost'}`}
                      onClick={() => set('alcohol_portions', score)}>{label}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-ink-soft mb-1.5">Как часто за один раз — 6 и более порций?</div>
          <div className="flex flex-wrap gap-1.5">
            {AUDIT_FREQ.map((label, score) => (
              <button key={label} type="button"
                      className={`btn btn-sm ${a.alcohol_binge === score ? 'btn-gold' : 'btn-ghost'}`}
                      onClick={() => set('alcohol_binge', score)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#e5e7eb] p-3.5">
        <p className="text-sm font-bold text-teal-dark leading-snug mb-2.5">Принимали ли Вы за последний год психотропные или наркотические вещества без назначения врача?</p>
        <YesNo value={a.drugs_last_year as boolean | undefined} onChange={(v) => set('drugs_last_year', v)} />
      </div>
    </div>
  )
}

const STEP_TITLES = [
  'Диагнозы от врача',
  'Перенесённое и наследственность',
  'Сердце и сосуды',
  'Лёгкие и пищеварение',
  'Привычки и питание',
  'Другие жалобы',
]

export default function AnamnesisSurvey({ initial, alarmKeys, onSaved, onCancel }: {
  initial: string | null
  alarmKeys?: string[]   // из API (MedCard.alarm_keys); не пришло — fallback на ALARM_KEYS
  onSaved: (surveyJson: string, chronicText: string) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState(0)
  const [a, setA] = useState<SurveyAnswers>(() => {
    try { return initial ? JSON.parse(initial) as SurveyAnswers : {} }
    catch { return {} }
  })

  function set(key: string, v: boolean | number | string) {
    setA((prev) => ({ ...prev, [key]: v }))
  }

  const activeAlarmKeys = useMemo(
    () => (alarmKeys ? new Set(alarmKeys) : ALARM_KEYS),
    [alarmKeys],
  )
  const alarms = useMemo(
    () => Array.from(activeAlarmKeys).filter((k) => a[k] === true),
    [activeAlarmKeys, a],
  )
  const auditC = (Number(a.alcohol_freq) || 0) + (Number(a.alcohol_portions) || 0) + (Number(a.alcohol_binge) || 0)

  // Человекочитаемая строка для поля «Хронические заболевания»
  function composeChronic(): string {
    const parts: string[] = []
    for (const item of DX_ITEMS) {
      if (a[item.key] !== true) continue
      let text = SURVEY_SHORT[item.key] ?? item.key
      text = text.charAt(0).toUpperCase() + text.slice(1)
      if (item.rx && a[item.rx] === true) text += ' (принимает препараты)'
      if (item.extra && a[item.extra.key]) text += ` — ${a[item.extra.key]}`
      parts.push(text)
    }
    if (a.hx_mi_self === true) parts.push('Инфаркт миокарда в анамнезе')
    if (a.hx_stroke_self === true) parts.push('Инсульт в анамнезе')
    return parts.join('; ')
  }

  function finish() {
    const surveyJson = JSON.stringify(a)
    onSaved(surveyJson, composeChronic())
  }

  function renderStep() {
    switch (step) {
      case 0: return <DiagnosesStep a={a} set={set} />
      case 1: return <YesNoStep items={HX_ITEMS} a={a} set={set} alarmKeys={activeAlarmKeys} />
      case 2:
        return <YesNoStep items={CARDIO_ITEMS.filter((i) => i.key !== 'sym_chest_pain_relieves' || a.sym_chest_pain === true)} a={a} set={set} alarmKeys={activeAlarmKeys} />
      case 3: return <YesNoStep items={LUNG_GI_ITEMS} a={a} set={set} alarmKeys={activeAlarmKeys} />
      case 4: return <HabitsStep a={a} set={set} />
      default:
        return (
          <div className="flex flex-col gap-4">
            <div>
              <label className="flip-label" htmlFor="s-other">Есть ли другие жалобы на здоровье, которые Вы хотели бы сообщить врачу?</label>
              <textarea id="s-other" className="flip-input min-h-[80px]" maxLength={1000}
                        value={String(a.other_complaints ?? '')}
                        onChange={(e) => set('other_complaints', e.target.value)} />
            </div>
            {alarms.length > 0 && (
              <div className="rounded-xl border border-coral/40 bg-[#dc262608] p-4">
                <div className="text-sm font-extrabold text-coral-dark mb-2">
                  Обратите внимание: {alarms.length} {alarms.length === 1 ? 'пункт' : 'пункта'} требуют осмотра врача
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {alarms.map((k) => (
                    <span key={k} className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[#dc262614] text-coral-dark">
                      {SURVEY_SHORT[k] ?? k}
                    </span>
                  ))}
                </div>
                <button type="button" className="btn btn-gold btn-sm mt-3" onClick={finish}>
                  Завершить и записаться к врачу
                </button>
              </div>
            )}
            {auditC >= 6 && (
              <div className="badge badge-gold normal-case tracking-normal w-fit">
                Сумма баллов AUDIT-C: {auditC} — риск пагубного потребления алкоголя
              </div>
            )}
            <button type="button" className="btn btn-gold w-fit" onClick={finish}>
              Завершить опросник
            </button>
          </div>
        )
    }
  }

  return (
    <div className="bg-white rounded-xl p-6 glow-soft flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-extrabold text-teal-dark">{STEP_TITLES[step]}</div>
          <div className="text-xs font-bold text-ink-soft mt-0.5">
            Опросник Минздрава РФ (приказ № 404н) · шаг {step + 1} из {STEP_TOTAL}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Закрыть опросник">✕</button>
      </div>

      <div aria-label="Прогресс анкеты" role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={Math.round(((step + 1) / STEP_TOTAL) * 100)}
           className="h-1.5 rounded-full bg-[#e5e7eb] overflow-hidden">
        <div className="h-full rounded-full bg-teal transition-quick"
             style={{ width: `${Math.round(((step + 1) / STEP_TOTAL) * 100)}%` }} />
      </div>

      {renderStep()}

      <div className="flex flex-wrap gap-2">
        {step > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep((s) => s - 1)}>
            ← Назад
          </button>
        )}
        {step < STEP_TOTAL - 1 && (
          <button type="button" className="btn btn-gold btn-sm ml-auto" onClick={() => setStep((s) => s + 1)}>
            Далее →
          </button>
        )}
      </div>

      <div className="flip-hint">
        Ответы не являются диагнозом. Их увидит врач вашего филиала перед приёмом.
      </div>
    </div>
  )
}
