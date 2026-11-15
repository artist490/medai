// Мои цели: редактор целевых шагов/сна/воды/веса (F008)
import { FormEvent, useState } from 'react'
import { saveGoals } from '../../api'
import type { Goals } from '../../types'

export default function GoalsEditor({ goals, onSaved }: {
  goals: Goals
  onSaved: (g: Goals) => void
}) {
  const [form, setForm] = useState({
    steps: goals.steps?.toString() ?? '',
    sleep: goals.sleep?.toString() ?? '',
    water: goals.water?.toString() ?? '',
    weight: goals.weight?.toString() ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  function field(label: string, key: 'steps' | 'sleep' | 'water' | 'weight', unit: string) {
    return (
      <div>
        <label className="flip-label" htmlFor={'goal-' + key}>{label}</label>
        <input
          id={'goal-' + key}
          type="number"
          className="flip-input"
          value={form[key]}
          onChange={(e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setSaved(false) }}
        />
        <div className="flip-hint">{unit}</div>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const savedGoals = await saveGoals({
        steps: form.steps ? Number(form.steps) : null,
        sleep: form.sleep ? Number(form.sleep) : null,
        water: form.water ? Number(form.water) : null,
        weight: form.weight ? Number(form.weight) : null,
      })
      onSaved(savedGoals)
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {field('Шаги в день', 'steps', 'шагов, например 8000')}
        {field('Сон', 'sleep', 'часов, например 8')}
        {field('Вода', 'water', 'мл в день, например 2000')}
        {field('Целевой вес', 'weight', 'кг')}
      </div>
      {saved && (
        <div className="badge badge-green normal-case tracking-normal w-fit">Сохранено</div>
      )}
      <button className="btn btn-teal w-fit" disabled={busy}>
        {busy ? 'Сохраняем…' : 'Сохранить цели'}
      </button>
    </form>
  )
}
