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
      const updated = await api.updateProfile({
        name: name.trim(),
        age: age > 0 ? age : null,
        sex: sex || null,
        height_cm: height > 0 ? height : null,
        branch_id: branchId ? Number(branchId) : null,
      })
      setUser(updated)
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
        title={<>Профиль <Icon name="profile" size={26} className="inline-block align-[-4px]" /></>}
      />

      {/* Hero: кольцо заполненности + идентичность */}
      <section className="rounded-2xl bg-teal-dark text-white px-7 py-6 flex flex-wrap items-center gap-7">
        <div className="relative w-[110px] h-[110px] shrink-0" role="img" aria-label={`Профиль заполнен на ${pct}%`}>
          <svg viewBox="0 0 120 120" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }} aria-hidden>
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="10" />
            <circle
              cx="60" cy="60" r="52" fill="none"
              stroke="#7fd8c9" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - pct / 100)}
              style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.7,.2,1)' }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="text-2xl font-extrabold tabular-nums leading-none">{pct}<span className="text-sm opacity-70 ml-0.5">%</span></div>
              <div className="text-[10px] opacity-70 font-bold mt-0.5">заполнено</div>
            </div>
          </div>
        </div>

        <div className="min-w-[240px] flex-1">
          <h2 className="text-[18px] font-extrabold">
            {pct === 100 ? 'Ваш профиль готов' : 'Ещё немного до персонального плана'}
          </h2>
          <p className="text-sm text-white/70 mt-1 max-w-[46ch]">
            {pct === 100
              ? 'Профиль заполнен — нормы и ИМТ считаются точно под вас.'
              : 'Заполните оставшиеся поля, чтобы показатели и нормы подбирались под вас.'}
          </p>
        </div>

        <div className="flex items-center gap-3.5">
          <span className="w-14 h-14 rounded-full grid place-items-center font-extrabold text-lg shrink-0"
                style={{ background: '#0E6A61', color: '#EAF6F3' }} aria-hidden>
            {initials(name || user?.email || '')}
          </span>
          <div className="text-sm">
            <div className="font-bold">{name.trim() || user?.email}</div>
            <div className="text-white/70">{user?.email}</div>
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6 items-start">
        {/* Личное */}
        <section className="bg-white rounded-2xl glow-soft p-6">
          <div className="flex items-baseline justify-between gap-3 mb-5">
            <h3 className="text-lg font-extrabold">Личное</h3>
            <p className="text-xs font-bold text-ink-soft">Видно только вам и врачу филиала</p>
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <label className="flip-label" htmlFor="p-name">Имя</label>
              <input id="p-name" className="flip-input"
                     value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div>
              <span className="flip-label">Пол</span>
              <div className="relative grid grid-cols-2 rounded-full bg-[#eef4f2] p-1" role="radiogroup" aria-label="Пол">
                <span
                  aria-hidden
                  className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm transition-transform duration-300"
                  style={{ transform: sex === 'female' ? 'translateX(100%)' : 'translateX(0)' }}
                />
                {(['male', 'female'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={sex === value}
                    onClick={() => setSex(value)}
                    className={`relative z-[1] rounded-full py-2.5 text-sm font-bold transition-colors ${
                      sex === value ? 'text-[#1b2622]' : 'text-ink-soft'
                    }`}
                  >
                    <span className="inline-flex items-center justify-center gap-1.5">
                      <Icon name={value} size={14} />
                      {value === 'male' ? 'Мужской' : 'Женский'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="flip-label">Возраст</span>
              <div className="text-4xl font-extrabold tabular-nums leading-none text-[#1b2622] mt-1">
                {age > 0 ? age : '—'}<span className="text-base font-bold text-ink-soft ml-1">лет</span>
              </div>
              <div className="flex items-center gap-2.5 mt-3">
                <button type="button" aria-label="Уменьшить возраст"
                        className="w-10 h-10 rounded-full border border-[#dbe6e3] bg-[#f4f8f7] text-xl leading-none text-teal-dark hover:bg-teal-bg transition-quick"
                        onClick={() => setAge((v) => clamp((v || 35) - 1, 1, 120))}>−</button>
                <input type="range" min={1} max={120} value={age || 1} aria-label="Возраст"
                       className="flex-1 accent-teal-dark"
                       onChange={(e) => setAge(Number(e.target.value))} />
                <button type="button" aria-label="Увеличить возраст"
                        className="w-10 h-10 rounded-full border border-[#dbe6e3] bg-[#f4f8f7] text-xl leading-none text-teal-dark hover:bg-teal-bg transition-quick"
                        onClick={() => setAge((v) => clamp((v || 35) + 1, 1, 120))}>+</button>
              </div>
            </div>
          </div>
        </section>

        {/* Рост и вес */}
        <section className="bg-white rounded-2xl glow-soft p-6">
          <div className="flex items-baseline justify-between gap-3 mb-5">
            <h3 className="text-lg font-extrabold">Рост и вес</h3>
            <p className="text-xs font-bold text-ink-soft">Для расчёта ИМТ</p>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <div>
              <span className="flip-label">Рост</span>
              <div className="text-4xl font-extrabold tabular-nums leading-none text-[#1b2622] mt-1">
                {height > 0 ? height : '—'}<span className="text-base font-bold text-ink-soft ml-1">см</span>
              </div>
            </div>
            <div>
              <span className="flip-label">Вес</span>
              <div className="text-4xl font-extrabold tabular-nums leading-none text-[#1b2622] mt-1">
                {lastWeight ?? '—'}<span className="text-base font-bold text-ink-soft ml-1">кг</span>
              </div>
            </div>
          </div>

          {/* Ростомер */}
          <div className="mt-5 h-[64px] relative flex items-end gap-[4px] px-1" aria-hidden>
            {Array.from({ length: 40 }).map((_, i) => {
              const share = height > 0 ? (height - 50) / 200 : 0
              return (
                <span
                  key={i}
                  className={`flex-1 rounded-sm transition-colors duration-200 ${i % 5 === 0 ? 'h-[60%]' : 'h-[30%]'} ${
                    height > 0 && i < Math.round(share * 40) ? 'bg-teal' : 'bg-[#dbe6e3]'
                  }`}
                />
              )
            })}
            <span
              className="absolute -top-1 w-[2px] h-[74px] bg-[#1b2622] transition-[left] duration-300"
              style={{ left: `${height > 0 ? ((height - 50) / 200) * 100 : 0}%` }}
            />
          </div>

          <div className="flex items-center gap-2.5 mt-3">
            <button type="button" aria-label="Уменьшить рост"
                    className="w-10 h-10 rounded-full border border-[#dbe6e3] bg-[#f4f8f7] text-xl leading-none text-teal-dark hover:bg-teal-bg transition-quick"
                    onClick={() => setHeight((v) => clamp((v || 165) - 1, 50, 250))}>−</button>
            <input type="range" min={50} max={250} value={height || 165} aria-label="Рост, см"
                   className="flex-1 accent-teal-dark"
                   onChange={(e) => setHeight(Number(e.target.value))} />
            <button type="button" aria-label="Увеличить рост"
                    className="w-10 h-10 rounded-full border border-[#dbe6e3] bg-[#f4f8f7] text-xl leading-none text-teal-dark hover:bg-teal-bg transition-quick"
                    onClick={() => setHeight((v) => clamp((v || 165) + 1, 50, 250))}>+</button>
          </div>
          <p className="flip-hint mt-3">
            Вес берётся из последнего замера — обновите его в дневнике.
          </p>
        </section>
      </div>

      {/* ИМТ */}
      <section className="bg-white rounded-2xl glow-soft p-6">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h3 className="text-lg font-extrabold">Индекс массы тела</h3>
          <p className="text-xs font-bold text-ink-soft">Считается по росту и последнему весу</p>
        </div>

        {bmi !== null && status ? (
          <>
            <div className="flex flex-wrap justify-between items-end gap-6">
              <div>
                <div className="text-5xl font-extrabold tabular-nums leading-none text-[#1b2622]">{bmi.toFixed(1)}</div>
                <span className={`inline-block mt-2 px-3 py-1 rounded-full text-[13px] font-bold ${
                  status.warn ? 'bg-[#fbe9dc] text-coral-dark' : 'bg-[#e0f2ef] text-teal-dark'
                }`}>
                  {status.label}
                </span>
              </div>
              <p className="text-sm text-[#5f6f6c] max-w-[38ch]">{status.note}</p>
            </div>

            <div className="mt-6 relative" aria-hidden>
              <div className="h-2.5 rounded-full"
                   style={{ background: 'linear-gradient(90deg,#8DB7D9 0%,#6FD3C2 30%,#6FD3C2 52%,#E8B964 72%,#D9803F 100%)' }} />
              <span className="absolute -top-[7px] w-[22px] h-[22px] rounded-full bg-white border-4 border-[#1b2622] transition-[left] duration-500"
                    style={{ left: `${clamp((bmi - 16) / 19, 0, 1) * 100}%`, transform: 'translateX(-50%)' }} />
            </div>
            <div className="flex justify-between text-xs text-ink-soft mt-2" aria-hidden>
              <span>16</span><span>18.5</span><span>25</span><span>30</span><span>35+</span>
            </div>
          </>
        ) : (
          <div className="text-sm text-[#5f6f6c]">
            ИМТ появится, когда в замерах появится вес — сделайте замер с весом в дневнике.
          </div>
        )}
      </section>

      {/* Филиал: карта и список городов в две колонки — формат 16:10 вместо
          растянутой на всю ширину полосы */}
      <section className="bg-white rounded-2xl glow-soft p-6">
        <div className="flex items-baseline justify-between gap-3 mb-4">
          <h3 className="text-lg font-extrabold">Филиал</h3>
          <p className="text-xs font-bold text-ink-soft">Для записи и результатов</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-stretch">
          {/* Локальная карта: тайлы с нашего сервера (offline), пин выбранного филиала */}
          <div className="relative rounded-xl overflow-hidden border border-[#e4ebe9] z-0">
            {branchCity && CITY_COORDS[branchCity] && CITY_SLUG[branchCity] ? (
              <>
                <BranchMap
                  slug={CITY_SLUG[branchCity]}
                  lat={CITY_COORDS[branchCity][0]}
                  lon={CITY_COORDS[branchCity][1]}
                  city={branchCity}
                />
                <span className="absolute right-3 top-3 z-[900] bg-teal-dark text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-md">
                  {branchCity}
                </span>
                <a
                  href={`https://yandex.ru/maps/?pt=${CITY_COORDS[branchCity][1]},${CITY_COORDS[branchCity][0]}&z=15`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute right-3 top-[52px] z-[900] bg-white/95 text-teal-dark text-xs font-bold px-3 py-1.5 rounded-full shadow-md border border-[#e4ebe9] hover:bg-teal-bg transition-quick"
                >
                  Яндекс.Карты
                </a>
              </>
            ) : (
              <div className="h-[260px] lg:h-[340px] grid place-items-center bg-[#f4f8f7]">
                <p className="text-sm text-ink-soft font-bold px-6 text-center">
                  Выберите филиал — покажу его на карте
                </p>
              </div>
            )}
          </div>

          {/* Города: скролл-список рядом с картой, а не под ней */}
          <div role="radiogroup" aria-label="Выберите филиал"
               className="grid gap-2 content-start max-h-[240px] lg:max-h-[340px] overflow-y-auto pr-1 [scrollbar-width:thin]">
          {branches.map((b) => {
            const on = String(b.id) === branchId
            return (
              <button
                key={b.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setBranchId(String(b.id))}
                className={`w-full flex justify-between items-center px-4 py-3 rounded-xl border text-left transition-quick ${
                  on ? 'border-teal bg-[#f6fbfa] shadow-[inset_3px_0_0_#00b8a9]' : 'border-[#e4ebe9] bg-[#f8fbfa] hover:border-teal'
                }`}
              >
                <span className="min-w-0">
                  <span className="text-sm font-bold text-[#1b2622]">{b.city}</span>
                  {CITY_ADDR[b.city] && (
                    <span className="block text-xs text-ink-soft">{CITY_ADDR[b.city]}</span>
                  )}
                </span>
                <span aria-hidden className={`w-5 h-5 rounded-full border-2 relative ${
                  on ? 'border-teal' : 'border-[#dbe6e3]'
                }`}>
                  {on && <span className="absolute inset-[3px] rounded-full bg-teal" />}
                </span>
              </button>
            )
          })}
          </div>
        </div>
      </section>

      {/* Липкая панель сохранения */}
      <div className="sticky bottom-[86px] lg:bottom-5 z-30">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white/95 backdrop-blur border border-[#e4ebe9] rounded-2xl px-5 py-3 shadow-[0_10px_30px_-12px_rgba(11,60,56,0.25)]">
          <p className="text-sm text-[#5f6f6c]">
            {error
              ? <span className="font-bold text-coral-dark">{error}</span>
              : saved
                ? <span className="font-bold text-teal-dark inline-flex items-center gap-1.5"><Icon name="check" size={14} />Профиль обновлён</span>
                : 'Изменения сохранятся в вашей карте'}
          </p>
          <button onClick={submit} disabled={busy}
                  className={`btn btn-sm ${saved ? 'bg-[#2E7D4F] text-white hover:bg-[#2E7D4F]' : 'btn-gold'} min-w-[180px]`}>
            {busy ? 'Сохраняем…' : saved ? 'Сохранено ✓' : 'Сохранить профиль'}
          </button>
        </div>
      </div>

      {/* Выход: подтверждение перед действием — как во всех разрушительных действиях */}
      <button className="btn btn-ghost w-fit" onClick={handleLogout}>
        Выйти из аккаунта
      </button>
    </div>
  )
}
