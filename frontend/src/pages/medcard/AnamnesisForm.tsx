// Анкета-анамнез: форма медкарты пациента (разделено из MedCard.tsx, F008)
import { FormEvent, useState } from 'react'
import * as api from '../../api'
import { Icon } from '../../components/Icon'
import { CardCompleteness, CardFormFields, defaultCardForm } from '../../components/CardAnamnesis'
import type { CardFormState } from '../../components/CardAnamnesis'
import type { MedCard } from '../../types'
import { fmtDate } from './shared'

export default function AnamnesisForm({ card }: { card: MedCard }) {
  const [form, setForm] = useState<CardFormState>(defaultCardForm(card))
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function setField(key: keyof CardFormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await api.updateMedCard(form)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-xl p-6 glow-soft flex flex-col gap-4">
      <CardCompleteness card={card} />
      <CardFormFields form={form} setField={setField} />

      <div className="flip-hint">
        Эти данные видит врач вашего филиала перед приёмом — так визит пройдёт быстрее.
      </div>

      {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
      {saved && <div className="badge badge-green normal-case tracking-normal w-fit"><Icon name="check" size={12} className="inline-block align-[-1px] mr-1" />Сохранено</div>}

      <button className="btn btn-gold w-fit" disabled={busy}>
        {busy ? 'Сохраняем…' : 'Сохранить анкету'}
      </button>

      {card.updated_by === 'doctor' && card.updated_at && (
        <div className="text-xs font-bold text-ink-soft">
          Анкету дополнял врач · {fmtDate(card.updated_at)}
        </div>
      )}
    </form>
  )
}
