import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../api'
import type { MeasurementInput } from '../api'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import PageHeader from '../components/PageHeader'
import FlowTabs from '../components/FlowTabs'

// Поле ввода одного показателя с подсказкой нормы
function Field(props: {
  id: string
  icon?: IconName
  label: string
  hint: string
  unit?: string
  step?: string
  min?: number
  max?: number
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="flip-label flex items-center gap-1.5" htmlFor={props.id}>
        {props.icon && <Icon name={props.icon} size={14} className="opacity-55" />}
        {props.label}
      </label>
      <input
        id={props.id}
        type="number"
        inputMode="decimal"
        step={props.step ?? '1'}
        min={props.min}
        max={props.max}
        className="flip-input"
        placeholder="—"
        value={props.value}
        aria-describedby={`${props.id}-hint`}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <div id={`${props.id}-hint`} className="flip-hint">
        норма {props.hint}
        {props.unit ? ` · ${props.unit}` : ''}
      </div>
    </div>
  )
}

const emptyForm = {
  systolic: '', diastolic: '', pulse: '', temperature: '', spo2: '',
  sleep_hours: '', steps: '', water_ml: '', weight_kg: '',
}
type FormShape = typeof emptyForm

// «Отправить» активна, когда заполнен хотя бы один показатель
function hasAnyValue(form: FormShape): boolean {
  return Object.values(form).some((v) => v.trim() !== '')
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="measurement-section">
      <h2 className="text-[13px] font-medium text-ink mb-4">{title}</h2>
      {children}
    </section>
  )
}

export default function NewMeasurement() {
  const [form, setForm] = useState<FormShape>(emptyForm)
  const [period, setPeriod] = useState<'morning' | 'evening'>(new Date().getHours() < 12 ? 'morning' : 'evening')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [moreOpen, setMoreOpen] = useState(() => window.matchMedia('(min-width: 640px)').matches)
  const navigate = useNavigate()

  function set(key: keyof FormShape) {
    return (v: string) => setForm((f) => ({ ...f, [key]: v }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))
      const input: MeasurementInput = {
        systolic: num(form.systolic),
        diastolic: num(form.diastolic),
        pulse: num(form.pulse),
        temperature: num(form.temperature),
        spo2: num(form.spo2),
        sleep_hours: num(form.sleep_hours),
        steps: num(form.steps),
        water_ml: num(form.water_ml),
        weight_kg: num(form.weight_kg),
      }
      const created = await api.createMeasurement({ ...input, period })
      navigate(`/result/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить замер')
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 stagger">
      <PageHeader
        title="Новый замер"
        sub="Заполните только то, что измерили. Остальное можно пропустить — данные не обязательны."
      />

      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12.5px] text-ink-soft">Период дня</span>
          <FlowTabs
            ariaLabel="Период дня"
            items={[{ id: 'morning' as const, label: 'Утро' }, { id: 'evening' as const, label: 'Вечер' }]}
            value={period}
            onChange={setPeriod}
          />
        </div>

        <Section title="Давление и пульс">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field id="systolic" label="Систолическое" unit="мм рт. ст." hint="до 120" min={50} max={280} value={form.systolic} onChange={set('systolic')} />
            <Field id="diastolic" label="Диастолическое" unit="мм рт. ст." hint="до 80" min={30} max={200} value={form.diastolic} onChange={set('diastolic')} />
            <Field id="pulse" icon="pulse" label="Пульс" unit="уд/мин" hint="60–100" min={30} max={250} value={form.pulse} onChange={set('pulse')} />
          </div>
        </Section>

        <details className="measurement-more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)}>
          <summary>
            <span className="flex items-center gap-2 text-[13px]">
              <Icon name="steps" size={16} /> Дополнительные показатели
            </span>
            <span className="measurement-more-hint">
              Температура, вес, сон, активность <Icon name="chevron" size={13} />
            </span>
          </summary>

          <div className="measurement-more-content">
            <Section title="Температура и сатурация">
              <div className="grid grid-cols-2 gap-4">
                <Field id="temperature" label="Температура" unit="°C" hint="36.1–37.0" step="0.1" min={33} max={43} value={form.temperature} onChange={set('temperature')} />
                <Field id="spo2" icon="lungs" label="SpO₂" unit="%" hint="95–100" min={50} max={100} value={form.spo2} onChange={set('spo2')} />
              </div>
            </Section>

            <Section title="Вес">
              <div className="grid grid-cols-2 gap-4">
                <Field id="weight" label="Вес" unit="кг" hint="ИМТ 18.5–24.9" step="0.1" min={20} max={400} value={form.weight_kg} onChange={set('weight_kg')} />
              </div>
              <div className="flip-hint mt-3">ИМТ считается автоматически, если в профиле указан рост.</div>
            </Section>

            <Section title="Образ жизни за сегодня">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field id="sleep" icon="sleep" label="Сон" unit="ч" hint="7–9" step="0.5" min={0} max={24} value={form.sleep_hours} onChange={set('sleep_hours')} />
                <Field id="steps" icon="steps" label="Шаги" unit="шагов" hint="8000–10000" min={0} max={200000} value={form.steps} onChange={set('steps')} />
                <Field id="water" icon="water" label="Вода" unit="мл" hint="≈2000" min={0} max={10000} value={form.water_ml} onChange={set('water_ml')} />
              </div>
            </Section>
          </div>
        </details>

        {error && (
          <div
            role="alert"
            className="text-[12.5px] text-coral-dark bg-[#fbf1f0] border border-[#e8cfcc] rounded-md px-3 py-2"
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn btn-gold" disabled={busy || !hasAnyValue(form)}>
            {busy ? 'Разбираем показатели…' : 'Сохранить и разобрать'}
            {!busy && <Icon name="arrow" size={15} />}
          </button>
          <span className="text-[11.5px] text-ink-soft">
            Разбор появится сразу после сохранения.
          </span>
        </div>
      </form>
    </div>
  )
}
