import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '../api'
import type { MeasurementInput } from '../api'
import { Icon } from '../components/Icon'
import type { IconName } from '../components/Icon'
import PageHeader from '../components/PageHeader'
import FlowTabs from '../components/FlowTabs'

// Поле ввода одного показателя с нормой-подсказкой (cream-инпут Flip7)
function Field(props: {
  id: string
  icon?: IconName
  label: string
  hint: string
  step?: string
  min?: number
  max?: number
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="flip-label flex items-center gap-2" htmlFor={props.id}>
        {props.icon && <Icon name={props.icon} size={16} />}
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
        onChange={(e) => props.onChange(e.target.value)}
      />
      <div className="flip-hint">норма: {props.hint}</div>
    </div>
  )
}

const emptyForm = {
  systolic: '', diastolic: '', pulse: '', temperature: '', spo2: '',
  sleep_hours: '', steps: '', water_ml: '', weight_kg: '',
}
type FormShape = typeof emptyForm

// Разблокировка «Отправить», когда заполнен хотя бы один показатель
function hasAnyValue(form: FormShape): boolean {
  return Object.values(form).some((v) => v.trim() !== '')
}

export default function NewMeasurement() {
  const [form, setForm] = useState<FormShape>(emptyForm)
  const [period, setPeriod] = useState<'morning' | 'evening'>(new Date().getHours() < 12 ? 'morning' : 'evening')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
    <div className="flex flex-col gap-5 stagger">
      <PageHeader
        title={<>Новый замер <Icon name="stethoscope" size={26} className="inline-block align-[-4px]" /></>}
        sub="Заполните только то, что измерили. Остальное можно пропустить."
      />

      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold text-[#465a56]">Период дня:</span>
          <FlowTabs
            ariaLabel="Период дня"
            items={[{ id: 'morning' as const, label: 'Утро' }, { id: 'evening' as const, label: 'Вечер' }]}
            value={period}
            onChange={setPeriod}
          />
        </div>
        <section className="bg-white rounded-xl p-5 glow-soft">
          <div className="section-title mb-4">
            <span className="emoji-box"><Icon name="pressure" size={20} /></span> Давление и пульс
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field id="systolic" label="Систолическое" hint="до 120" min={50} max={280} value={form.systolic} onChange={set('systolic')} />
            <Field id="diastolic" label="Диастолическое" hint="до 80" min={30} max={200} value={form.diastolic} onChange={set('diastolic')} />
            <Field id="pulse" icon="pulse" label="Пульс" hint="60–100" min={30} max={250} value={form.pulse} onChange={set('pulse')} />
          </div>
        </section>

        <section className="bg-white rounded-xl p-5 glow-soft">
          <div className="section-title mb-4">
            <span className="emoji-box"><Icon name="temperature" size={20} /></span> Температура и сатурация
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field id="temperature" label="Температура" hint="36.1–37.0" step="0.1" min={33} max={43} value={form.temperature} onChange={set('temperature')} />
            <Field id="spo2" icon="lungs" label="SpO₂" hint="95–100" min={50} max={100} value={form.spo2} onChange={set('spo2')} />
          </div>
        </section>

        <section className="bg-white rounded-xl p-5 glow-soft">
          <div className="section-title mb-4">
            <span className="emoji-box"><Icon name="scale" size={20} /></span> Вес
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field id="weight" label="Вес" hint="ИМТ 18.5–24.9" step="0.1" min={20} max={400} value={form.weight_kg} onChange={set('weight_kg')} />
          </div>
          <div className="flip-hint">ИМТ считается автоматически, если в профиле указан рост.</div>
        </section>

        <section className="bg-white rounded-xl p-5 glow-soft">
          <div className="section-title mb-4">
            <span className="emoji-box"><Icon name="sleep" size={20} /></span> Образ жизни за сегодня
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field id="sleep" label="Сон" hint="7–9 ч" step="0.5" min={0} max={24} value={form.sleep_hours} onChange={set('sleep_hours')} />
            <Field id="steps" icon="steps" label="Шаги" hint="8000–10000" min={0} max={200000} value={form.steps} onChange={set('steps')} />
            <Field id="water" icon="water" label="Вода" hint="≈2000 мл" min={0} max={10000} value={form.water_ml} onChange={set('water_ml')} />
          </div>
        </section>

        {error && (
          <div className="badge badge-red justify-center normal-case tracking-normal">{error}</div>
        )}

        <button className="btn btn-gold w-full text-base" disabled={busy || !hasAnyValue(form)}>
          {busy ? 'ИИ анализирует…' : (<span className="inline-flex items-center gap-2">Проанализировать <Icon name="sparkle" size={16} /></span>)}
        </button>
      </form>
    </div>
  )
}
