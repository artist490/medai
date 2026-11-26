// Профиль: кольцо заполненности, живой ИМТ, ростомер, филиалы.
// Формат по наброску юзера; данные — те же (updateProfile), вес приходит
// из последнего замера (в профиле он не хранится — он в measurements).
import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import * as api from '../api'
import { Icon } from '../components/Icon'
import BranchMap from '../components/BranchMap'
import PageHeader from '../components/PageHeader'
import type { Branch } from '../types'

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '··'
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

// Крупное значение поля: число с единицей или тихая пометка «не указано».
// Прочерк в 32 px читается как линия-разделитель, поэтому пустое состояние — текст.
function BigValue({ value, unit }: { value: number | string | null; unit: string }) {
  if (value === null || value === '' || value === 0) {
    return <span className="text-[13px] text-ink-soft">не указано</span>
  }
  return (
    <>
      <span className="text-[32px] font-semibold tabular-nums leading-none tracking-[-0.02em]">{value}</span>
      <span className="text-[12px] text-ink-soft">{unit}</span>
    </>
  )
}

// Статус ИМТ — те же пороги, что в движке правил (rules.py)
function bmiStatus(bmi: number): { label: string; note: string; warn: boolean } {
  if (bmi < 18.5) return { label: 'Ниже нормы', note: 'Показатель ниже нормы — стоит обсудить питание с врачом.', warn: true }
  if (bmi < 25) return { label: 'Норма', note: 'Показатель в пределах нормы. Учитывайте его вместе с результатами замеров.', warn: false }
  if (bmi < 30) return { label: 'Избыточный вес', note: 'Есть смысл посмотреть на профилактику вместе с врачом.', warn: true }
  return { label: 'Ожирение', note: 'Рекомендуем обсудить план снижения веса с врачом.', warn: true }
}

const RING_C = 2 * Math.PI * 52

// Координаты филиалов — по фактическим адресам клиник (geocoded 2026-11-15)
const CITY_COORDS: Record<string, [number, number]> = {
  'Белая Калитва': [48.1707, 40.7903],   // ул. Заводская, 8А
  'Белгород': [50.6036, 36.5918],        // ул. Попова, 56Б
  'Брянск': [53.2427, 34.3413],          // ул. Красноармейская, 91
  'Бутурлиновка': [50.8164, 40.6030],    // ул. Дорожная, 69
  'Воронеж': [51.6863, 39.2677],         // Ленинский пр-т, 156
  'Вязьма': [55.2152, 34.3032],          // ул. Ленина, 57
  'Калининград': [54.7249, 20.5428],     // ул. Куйбышева, 78
  'Калуга': [54.5240, 36.2718],          // ул. Карла Либкнехта, 18
  'Каменск-Шахтинский': [48.3198, 40.2594], // ул. Степинь, 2А
  'Клинцы': [52.7546, 32.2339],          // ул. Пушкина, 22
  'Михайловка': [50.0797, 43.2342],      // центр города
  'Россошь': [50.1963, 39.5793],         // пр-т Труда, 1Г
  'Сочи': [43.5991, 39.7402],            // ул. Дагомысская, 47
  'Таганрог': [47.2536, 38.9188],        // ул. Дзержинского, 156
  'Тамбов': [52.7299, 41.4423],          // ул. Базарная, 130
}

// Адреса филиалов для списка (Михайловка — адрес не опубликован)
const CITY_ADDR: Record<string, string> = {
  'Белая Калитва': 'ул. Заводская, 8А',
  'Белгород': 'ул. Попова, 56Б',
  'Брянск': 'ул. Красноармейская, 91',
  'Бутурлиновка': 'ул. Дорожная, 69',
  'Воронеж': 'Ленинский пр-т, 156',
  'Вязьма': 'ул. Ленина, 57',
  'Калининград': 'ул. Куйбышева, 78',
  'Калуга': 'ул. Карла Либкнехта, 18',
  'Каменск-Шахтинский': 'ул. Степинь, 2А',
  'Клинцы': 'ул. Пушкина, 22',
  'Россошь': 'пр-т Труда, 1Г',
  'Сочи': 'ул. Дагомысская, 47',
  'Таганрог': 'ул. Дзержинского, 156',
  'Тамбов': 'ул. Базарная, 130',
}

// Slug города = папка тайлов (генерируются tools/make_tiles.py)
const CITY_SLUG: Record<string, string> = {
  'Белая Калитва': 'belaya-kalitva',
  'Белгород': 'belgorod',
  'Брянск': 'bryansk',
  'Бутурлиновка': 'buturlinovka',
  'Воронеж': 'voronezh',
  'Вязьма': 'vyazma',
  'Калининград': 'kaliningrad',
  'Калуга': 'kaluga',
  'Каменск-Шахтинский': 'kamensk-shakhtinsky',
  'Клинцы': 'klintsy',
  'Михайловка': 'mihaylovka',
  'Россошь': 'rossosh',
  'Сочи': 'sochi',
  'Таганрог': 'taganrog',
  'Тамбов': 'tambov',
}

export default function Profile() {
  const { user, setUser, logout } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState(user?.name ?? '')
  const [sex, setSex] = useState<'male' | 'female' | ''>(user?.sex ?? '')
  const [age, setAge] = useState(user?.age ?? 0)
  const [height, setHeight] = useState(user?.height_cm ?? 0)
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState(user?.branch?.id ? String(user.branch.id) : '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [lastWeight, setLastWeight] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.fetchBranches().then((d) => setBranches(d.items)).catch(() => {})
    // вес для ИМТ — из последнего замера (в профиле он не хранится)
    api.listMeasurements(1)
      .then((d) => setLastWeight(d.items[0]?.weight_kg ?? null))
      .catch(() => {})
  }, [])

  const branchCity = branches.find((b) => String(b.id) === branchId)?.city
  const filled = [name.trim(), sex, age > 0, height > 0, branchId].filter(Boolean).length
  const pct = Math.round((filled / 5) * 100)

  const bmi = lastWeight && height >= 50 ? lastWeight / (height / 100) ** 2 : null
  const status = bmi !== null ? bmiStatus(bmi) : null

  async function handleLogout() {
    if (!window.confirm('Выйти из аккаунта?')) return
    await logout()
    navigate('/login')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      if (user?.role === 'patient' && branchId && Number(branchId) !== user?.branch?.id) {
        if (!currentPassword) throw new Error('Для смены филиала введите текущий пароль')
        await api.changeBranch(Number(branchId), currentPassword)
      }
      const updated = await api.updateProfile({
        name: name.trim(),
        age: age > 0 ? age : null,
        sex: sex || null,
        height_cm: height > 0 ? height : null,
      })
      setUser(updated)
      setCurrentPassword('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className="flex flex-col gap-6 pb-2 stagger">
      <PageHeader
        eyebrow="Личные данные и филиал"
        title="Профиль"
        sub="Нормы показателей и ИМТ считаются по этим данным. Видны только вам и врачу вашего филиала."
      />

      {/* Идентичность: строка, а не цветная панель */}
      <section className="flex flex-wrap items-center gap-x-8 gap-y-4 pb-5 border-b border-line">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-11 h-11 rounded-full grid place-items-center text-[15px] font-semibold shrink-0"
            style={{ background: '#edf2f0', color: 'var(--color-teal-deep)' }}
            aria-hidden
          >
            {initials(name || user?.email || '')}
          </span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-ink truncate">{name.trim() || user?.email}</div>
            <div className="text-[12px] text-ink-soft truncate">{user?.email}</div>
          </div>
        </div>

        <div className="flex-1 min-w-[220px]" role="img" aria-label={`Профиль заполнен на ${pct}%`}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11.5px] text-ink-soft">
              {pct === 100 ? 'Профиль заполнен' : 'Заполнено'}
            </span>
            <span className="text-[11.5px] text-ink-soft tabular-nums">{pct}%</span>
          </div>
          <div className="mt-1.5 h-1 rounded-full bg-[#eceeec] overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-dark"
              style={{ width: `${pct}%`, transition: 'width .4s cubic-bezier(.22,1,.36,1)' }}
            />
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6 items-start">
        {/* Личное */}
        <section className="panel">
          <div className="flex items-baseline justify-between gap-3 mb-5">
            <h2 className="text-[14px] font-medium text-ink">Личное</h2>
            <p className="text-[11.5px] text-ink-soft">Видно вам и врачу филиала</p>
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <label className="flip-label" htmlFor="p-name">Имя</label>
              <input
                id="p-name"
                className="flip-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <span className="flip-label">Пол</span>
              <div className="grid grid-cols-2 rounded-md border border-[#d9dedb] p-0.5" role="radiogroup" aria-label="Пол">
                {(['male', 'female'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={sex === value}
                    onClick={() => setSex(value)}
                    className={`rounded py-2 text-[13px] transition-quick ${
                      sex === value
                        ? 'bg-[#eef2f0] text-ink font-medium'
                        : 'text-ink-soft hover:text-ink'
                    }`}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Icon name={value} size={13} />
                      {value === 'male' ? 'Мужской' : 'Женский'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="flip-label">Возраст</span>
              <div className="flex items-baseline gap-1.5 min-h-[32px]">
                <BigValue value={age > 0 ? age : null} unit="лет" />
              </div>
              <div className="flex items-center gap-3 mt-3">
                <button
                  type="button"
                  aria-label="Уменьшить возраст"
                  className="w-8 h-8 rounded border border-[#d9dedb] bg-white text-[15px] leading-none text-ink hover:bg-[#f6f8f7] transition-quick"
                  onClick={() => setAge((v) => clamp((v || 35) - 1, 1, 120))}
                >
                  −
                </button>
                <input
                  type="range" min={1} max={120} value={age || 1} aria-label="Возраст"
                  className="flex-1 accent-teal-dark"
                  onChange={(e) => setAge(Number(e.target.value))}
                />
                <button
                  type="button"
                  aria-label="Увеличить возраст"
                  className="w-8 h-8 rounded border border-[#d9dedb] bg-white text-[15px] leading-none text-ink hover:bg-[#f6f8f7] transition-quick"
                  onClick={() => setAge((v) => clamp((v || 35) + 1, 1, 120))}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Рост и вес */}
        <section className="panel">
          <div className="flex items-baseline justify-between gap-3 mb-5">
            <h2 className="text-[14px] font-medium text-ink">Рост и вес</h2>
            <p className="text-[11.5px] text-ink-soft">Для расчёта ИМТ</p>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div>
              <span className="flip-label">Рост</span>
              <div className="flex items-baseline gap-1.5 min-h-[32px]">
                <BigValue value={height > 0 ? height : null} unit="см" />
              </div>
            </div>
            <div>
              <span className="flip-label">Вес</span>
              <div className="flex items-baseline gap-1.5 min-h-[32px]">
                <BigValue value={lastWeight} unit="кг" />
              </div>
            </div>
          </div>

          {/* Ростомер: шкала без «пляшущих» блоков */}
          <div className="mt-6 h-12 relative flex items-end gap-[3px]" aria-hidden>
            {Array.from({ length: 40 }).map((_, i) => {
              const share = height > 0 ? (height - 50) / 200 : 0
              return (
                <span
                  key={i}
                  className={`flex-1 transition-colors duration-200 ${i % 5 === 0 ? 'h-6' : 'h-3'} ${
                    height > 0 && i < Math.round(share * 40) ? 'bg-teal-dark' : 'bg-[#e3e6e3]'
                  }`}
                />
              )
            })}
            <span
              className="absolute -top-1 w-px h-14 bg-ink transition-[left] duration-300"
              style={{ left: `${height > 0 ? ((height - 50) / 200) * 100 : 0}%` }}
            />
          </div>

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              aria-label="Уменьшить рост"
              className="w-8 h-8 rounded border border-[#d9dedb] bg-white text-[15px] leading-none text-ink hover:bg-[#f6f8f7] transition-quick"
              onClick={() => setHeight((v) => clamp((v || 165) - 1, 50, 250))}
            >
              −
            </button>
            <input
              type="range" min={50} max={250} value={height || 165} aria-label="Рост, см"
              className="flex-1 accent-teal-dark"
              onChange={(e) => setHeight(Number(e.target.value))}
            />
            <button
              type="button"
              aria-label="Увеличить рост"
              className="w-8 h-8 rounded border border-[#d9dedb] bg-white text-[15px] leading-none text-ink hover:bg-[#f6f8f7] transition-quick"
              onClick={() => setHeight((v) => clamp((v || 165) + 1, 50, 250))}
            >
              +
            </button>
          </div>
          <p className="flip-hint mt-3">Вес берётся из последнего замера в дневнике.</p>
        </section>
      </div>

      {/* ИМТ */}
      <section className="panel">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2 className="text-[14px] font-medium text-ink">Индекс массы тела</h2>
          <p className="text-[11.5px] text-ink-soft">По росту и последнему весу</p>
        </div>

        {bmi !== null && status ? (
          <>
            <div className="flex flex-wrap justify-between items-end gap-6">
              <div>
                <div className="text-[38px] font-semibold tabular-nums leading-none tracking-[-0.03em]">
                  {bmi.toFixed(1)}
                </div>
                <span className={`badge mt-2 ${status.warn ? 'badge-gold' : 'badge-green'}`}>
                  {status.label}
                </span>
              </div>
              <p className="text-[13px] text-ink-soft max-w-[42ch] leading-relaxed">{status.note}</p>
            </div>

            <div className="mt-6 relative" aria-hidden>
              <div
                className="h-1.5 rounded-full"
                style={{ background: 'linear-gradient(90deg,#9fb6c6 0%,#7fb3a8 30%,#7fb3a8 52%,#c9a26a 72%,#b07a4a 100%)' }}
              />
              <span
                className="absolute -top-1 w-3.5 h-3.5 rounded-full bg-white border-2 border-ink transition-[left] duration-500"
                style={{ left: `${clamp((bmi - 16) / 19, 0, 1) * 100}%`, transform: 'translateX(-50%)' }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-ink-soft mt-2 tabular-nums" aria-hidden>
              <span>16</span><span>18.5</span><span>25</span><span>30</span><span>35+</span>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-ink-soft leading-relaxed">
            ИМТ появится, когда в дневнике будет замер с весом.
          </p>
        )}
      </section>

      {/* Филиал */}
      <section className="panel">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h2 className="text-[14px] font-medium text-ink">Филиал</h2>
          <p className="text-[11.5px] text-ink-soft">Для записи и результатов</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-stretch">
          <div className="relative rounded-md overflow-hidden border border-line z-0">
            {branchCity && CITY_COORDS[branchCity] && CITY_SLUG[branchCity] ? (
              <>
                <BranchMap
                  slug={CITY_SLUG[branchCity]}
                  lat={CITY_COORDS[branchCity][0]}
                  lon={CITY_COORDS[branchCity][1]}
                  city={branchCity}
                />
                <span className="absolute right-3 top-3 z-[900] bg-white/95 border border-line text-ink text-[11.5px] px-2.5 py-1 rounded">
                  {branchCity}
                </span>
                <a
                  href={`https://yandex.ru/maps/?pt=${CITY_COORDS[branchCity][1]},${CITY_COORDS[branchCity][0]}&z=15`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute right-3 top-[42px] z-[900] bg-white/95 text-teal-dark text-[11.5px] px-2.5 py-1 rounded border border-line hover:bg-[#f6f8f7] transition-quick"
                >
                  Яндекс.Карты
                </a>
              </>
            ) : (
              <div className="h-[260px] lg:h-[340px] grid place-items-center bg-[#f7f9f8]">
                <p className="text-[13px] text-ink-soft px-6 text-center">
                  Выберите филиал — покажем его на карте
                </p>
              </div>
            )}
          </div>

          <div
            role="radiogroup"
            aria-label="Выберите филиал"
            className="grid gap-1.5 content-start max-h-[240px] lg:max-h-[340px] overflow-y-auto pr-1 [scrollbar-width:thin]"
          >
            {branches.map((b) => {
              const on = String(b.id) === branchId
              return (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => { if (user?.role === 'patient') setBranchId(String(b.id)) }}
                  disabled={user?.role !== 'patient'}
                  className={`w-full flex justify-between items-center gap-3 px-3 py-2.5 rounded-md border text-left transition-quick ${
                    on
                      ? 'border-teal-dark bg-[#f4f8f6]'
                      : 'border-line bg-white hover:border-[#c4ccc8]'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-ink">{b.city}</span>
                    {CITY_ADDR[b.city] && (
                      <span className="block text-[11.5px] text-ink-soft">{CITY_ADDR[b.city]}</span>
                    )}
                  </span>
                  <span
                    aria-hidden
                    className={`w-3.5 h-3.5 rounded-full border shrink-0 ${
                      on ? 'border-teal-dark bg-teal-dark' : 'border-[#c9d1cd]'
                    }`}
                  />
                </button>
              )
            })}
          </div>
        </div>

        {user?.role === 'patient' && branchId && Number(branchId) !== user?.branch?.id && (
          <div className="mt-4 max-w-md">
            <label className="flip-label" htmlFor="branch-password">Текущий пароль для смены филиала</label>
            <input
              id="branch-password" className="flip-input" type="password" autoComplete="current-password"
              value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <p className="flip-hint">Незавершённые записи на приём перенесутся в выбранный филиал.</p>
          </div>
        )}
        {user?.role === 'doctor' && (
          <p className="flip-hint mt-4">Смена филиала врача выполняется администратором клиники.</p>
        )}
      </section>

      {/* Панель сохранения: в потоке страницы, под картой филиала */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line rounded-lg bg-white px-4 py-3">
        <p className="text-[12.5px] text-ink-soft">
          {error
            ? <span className="text-coral-dark">{error}</span>
            : saved
              ? <span className="text-teal-dark inline-flex items-center gap-1.5"><Icon name="check" size={13} />Профиль обновлён</span>
              : 'Изменения сохранятся в вашей карте'}
        </p>
        <button onClick={submit} disabled={busy} className="btn btn-gold min-w-[170px]">
          {busy ? 'Сохраняем…' : saved ? 'Сохранено' : 'Сохранить профиль'}
        </button>
      </div>

      <button className="btn btn-ghost w-fit" onClick={handleLogout}>
        Выйти из аккаунта
      </button>
    </div>
  )
}
