import { FormEvent, useState } from 'react'
import { useAuth } from '../auth'
import * as api from '../api'
import { Icon } from '../components/Icon'

// Профиль: имя, возраст, пол, рост — нужны движку правил для норм и ИМТ.
export default function Profile() {
  const { user, setUser } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [age, setAge] = useState(user?.age?.toString() ?? '')
  const [sex, setSex] = useState<'male' | 'female' | ''>(user?.sex ?? '')
  const [height, setHeight] = useState(user?.height_cm?.toString() ?? '')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const updated = await api.updateProfile({
        name: name.trim(),
        age: age.trim() ? Number(age) : null,
        sex: sex || null,
        height_cm: height.trim() ? Number(height.replace(',', '.')) : null,
      })
      setUser(updated)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="mb-1">
        <div className="eyebrow">Настройки аккаунта</div>
        <h1 className="text-4xl mt-1.5" style={{ fontSize: 32, letterSpacing: '-0.5px' }}>Профиль <Icon name="profile" size={26} className="inline-block align-[-4px]" /></h1>
      </div>

      <form onSubmit={submit} className="bg-white rounded-xl p-6 glow-soft flex flex-col gap-4 max-w-md">
        <div>
          <label className="flip-label" htmlFor="p-name">Имя</label>
          <input id="p-name" className="flip-input" placeholder="Ваше имя"
                 value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="flip-label" htmlFor="p-age">Возраст</label>
            <input id="p-age" type="number" min={1} max={120} className="flip-input" placeholder="—"
                   value={age} onChange={(e) => setAge(e.target.value)} />
          </div>
          <div>
            <label className="flip-label" htmlFor="p-height">Рост, см</label>
            <input id="p-height" type="number" min={50} max={250} step="0.5" className="flip-input" placeholder="—"
                   value={height} onChange={(e) => setHeight(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="flip-label">Пол</label>
          <div className="flex gap-2">
            {(['male', 'female'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setSex(value)}
                className={`btn btn-sm flex-1 ${sex === value ? 'btn-teal' : 'btn-ghost'}`}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Icon name={value} size={14} />
                  {value === 'male' ? 'Мужской' : 'Женский'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flip-hint">
          Рост нужен для автоматического ИМТ, возраст и пол — для точных норм правил.
        </div>

        {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
        {saved && <div className="badge badge-green normal-case tracking-normal w-fit"><Icon name="check" size={12} className="inline-block align-[-1px] mr-1" />Сохранено</div>}

        <button className="btn btn-gold" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>

      <div className="text-xs text-teal-dark/50 font-bold">
        Аккаунт: {user?.email}
      </div>
    </div>
  )
}
