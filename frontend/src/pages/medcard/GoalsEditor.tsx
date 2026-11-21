// Мои цели: редактор целевых шагов/сна/воды/веса (F008)
import { FormEvent, useEffect, useState } from 'react'
import { saveGoals } from '../../api'
import type { Goals } from '../../types'

export default function GoalsEditor({ goals, onSaved, loaded = true }: {
  goals: Goals
  onSaved: (g: Goals) => void
  // цели грузятся асинхронно: пока не загружены — «Сохранить» заблокирована,
  // чтобы пустая форма не затёрла существующие значения
  loaded?: boolean
}) {
  const [form, setForm] = useState({
    steps: goals.steps?.toString() ?? '',
    sleep: goals.sleep?.toString() ?? '',
    water: goals.water?.toString() ?? '',
    weight: goals.weight?.toString() ?? '',
  })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Форма инициализируется от props один раз, а goals приходят асинхронно:
  // пока пользователь не начал правку — догоняем форму до загруженных целей
  useEffect(() => {
    if (touched) return
    setForm({
      steps: goals.steps?.toString() ?? '',
      sleep: goals.sleep?.toString() ?? '',
      water: goals.water?.toString() ?? '',
      weight: goals.weight?.toString() ?? '',
    })
  }, [goals, touched])

  function field(label: string, key: 'steps' | 'sleep' | 'water' | 'weight', unit: string) {
    return (
      <div>
        <label className="flip-label" htmlFor={'goal-' + key}>{label}</label>
        <input
          id={'goal-' + key}
          type="number"
          className="flip-input"
          value={form[key]}
          onChange={(e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setTouched(true); setSaved(false) }}
        />
        <div className="flip-hint">{unit}</div>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const savedGoals = await saveGoals({
        steps: form.steps ? Number(form.steps) : null,
        sleep: form.sleep ? Number(form.sleep) : null,
        water: form.water ? Number(form.water) : null,
        weight: form.weight ? Number(form.weight) : null,
      })
      onSaved(savedGoals)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить цели')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h2 className="text-lg">Мои цели</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {field('Шаги в день', 'steps', 'шагов, например 8000')}
        {field('Сон', 'sleep', 'часов, например 8')}
        {field('Вода', 'water', 'мл в день, например 2000')}
        {field('Целевой вес', 'weight', 'кг')}
      </div>
      {saved && (
        <div className="badge badge-green normal-case tracking-normal w-fit">Сохранено</div>
      )}
      {error && (
        <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>
      )}
      <button className="btn btn-gold w-fit" disabled={busy || !loaded}>
        {busy ? 'Сохраняем…' : 'Сохранить цели'}
      </button>
    </form>
  )
}
