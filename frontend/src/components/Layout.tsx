// Каркас в стиле Flip7 SaaS: сайдбар слева, топбар с поиском, контент, футер.
// На мобильных сайдбар скрывается — остаётся нижняя pill-навигация.
// Навигация зависит от роли: пациент — личные вкладки, врач — кабинет пациентов.
// Сайдбар как у Сбер Здоровья: профиль-блок, пункты с подписями и цветными
// акцентами иконок (teal/коралл/небо/золото — статусная семантика сохранена).
import { FormEvent, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useFlowIndicatorStyle, useFlowRect } from './useFlowRect'
import * as api from '../api'
import { useAuth } from '../auth'
import { brand } from '../brand'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import AvatarDoctor from './AvatarDoctor'
import AvatarPatient from './AvatarPatient'

type NavItem = { to: string; label: string; sub: string; icon: IconName; accent: 'teal' | 'coral' | 'sky' | 'gold' }

const patientNav: NavItem[] = [
  { to: '/', label: 'Дашборд', sub: 'Обзор здоровья', icon: 'home', accent: 'teal' },
  { to: '/medcard', label: 'Медкарта', sub: 'Анкета, приёмы, замеры', icon: 'care', accent: 'coral' },
  { to: '/chat', label: 'Ассистент', sub: 'ИИ-помощник клиники', icon: 'sparkle', accent: 'sky' },
  { to: '/profile', label: 'Профиль', sub: 'Личные данные', icon: 'profile', accent: 'gold' },
]

const doctorNav: NavItem[] = [
  { to: '/patients', label: 'Пациенты', sub: 'Кабинет врача', icon: 'stethoscope', accent: 'teal' },
  { to: '/analytics', label: 'Аналитика', sub: 'Статистика филиала', icon: 'chart', accent: 'gold' },
  { to: '/chat', label: 'Ассистент', sub: 'Помощник врача', icon: 'sparkle', accent: 'sky' },
  { to: '/profile', label: 'Профиль', sub: 'Личные данные', icon: 'profile', accent: 'gold' },
]

// Русские склонения возраста: 31 год, 34 года, 40 лет
function ageWord(age: number): string {
  const mod10 = age % 10
  const mod100 = age % 100
  if (mod10 === 1 && mod100 !== 11) return 'год'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'года'
  return 'лет'
}

// Кнопка нижней панели: иконка + подпись; активная тёмная плашка —
// общий перетекающий индикатор, у самой кнопки только цвет текста
function BarLink({ to, label, icon, end }: {
  to: string; label: string; icon: IconName; end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `bar-link justify-self-center flex flex-col items-center justify-center rounded-[10px] w-full max-w-[60px] px-0.5 py-1.5 transition-quick text-[10.5px] font-bold whitespace-nowrap ${
          isActive ? 'active text-white' : 'text-teal-dark hover:bg-teal-bg'
        }`
      }
    >
      <Icon name={icon} size={18} />
      <span className="mt-0.5 hidden min-[360px]:block">{label}</span>
    </NavLink>
  )
}

// Ассистент: кружок в собственной средней ячейке бара, никого не перекрывает
function AssistantSlot() {
  return (
    <NavLink
      to="/chat"
      className={({ isActive }) =>
        `justify-self-center flex items-center ${isActive ? 'assistant-fab-active' : ''}`
      }
    >
      <span className="assistant-fab-circle">
        <Icon name="sparkle" size={22} />
      </span>
    </NavLink>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const [signalCount, setSignalCount] = useState(0)

  useEffect(() => {
    if (user?.role !== 'doctor') return
    const load = () => api.fetchSignals().then((d) => setSignalCount(d.unread)).catch(() => {})
    load()
    // Сигналы врача обновляются сами: новый красный замер появится без перезагрузки
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [user])
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  // Перетекающий индикатор: белая карточка в сайдбаре и плашка в мобильном баре
  const navRef = useRef<HTMLElement>(null)
  const navRect = useFlowRect(navRef, '.sidebar-link.active', location.pathname)
  const navIndicator = useFlowIndicatorStyle(navRect)
  const barRef = useRef<HTMLDivElement>(null)
  const barRect = useFlowRect(barRef, '.bar-link.active', location.pathname)
  const barIndicator = useFlowIndicatorStyle(barRect)
  const isDoctor = user?.role === 'doctor'
  const navItems = isDoctor ? doctorNav : patientNav
  const onChat = location.pathname.startsWith('/chat')

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `${isDoctor ? '/patients' : '/medcard?tab=meas'}${isDoctor ? '?' : '&'}q=${encodeURIComponent(q)}` : (isDoctor ? '/patients' : '/medcard?tab=meas'))
  }

  return (
    <div className="min-h-screen lg:grid" style={{ gridTemplateColumns: '250px 1fr' }}>
      {/* ---- Сайдбар (desktop) ---- */}
      <aside className="hidden lg:flex flex-col justify-between sticky top-0 h-screen sidebar-shell border-r border-[#e9efed] px-5 py-6">
        <div>
          <NavLink to="/" className="block px-2 anim-rise">
            <div className="flex items-center gap-2.5">
              <span className="brand-mark" aria-hidden>
                <svg width="30" height="30" viewBox="0 0 30 30">
                  <circle cx="15" cy="15" r="8.5" fill="#E23A3A" />
                  <circle cx="15" cy="15" r="11.5" fill="none" stroke="#E23A3A" strokeOpacity="0.25" strokeWidth="1.5" />
                </svg>
              </span>
              <div>
                <div className="wordmark" style={{ fontSize: 18 }}>Спектр-Диагностика</div>
                <div className="wordmark-sub">{brand.subtitle}</div>
              </div>
            </div>
          </NavLink>

          {/* Профиль-карточка: аватар, имя, роль */}
          <div className="profile-card mt-7 flex items-center gap-3 px-3 py-3 anim-rise" style={{ animationDelay: '60ms' }}>
            {isDoctor ? (
              <AvatarDoctor size={44} />
            ) : (
              <span className="doctor-avatar text-white" style={{ width: 44, height: 44 }}>
                <AvatarPatient size={36} />
              </span>
            )}
            <div className="min-w-0">
              <div className="text-sm font-bold text-[#1b2622] truncate">{user?.name || user?.email}</div>
              <div className="text-xs text-[#8aa09c]">
                {user?.age ? `${user.age} ${ageWord(user.age)}` : (isDoctor ? 'врач клиники' : 'пациент')}
              </div>
            </div>
          </div>

          <div className="mx-1 my-4 h-px bg-[#e9efed]" />

          <nav ref={navRef} className="flex flex-col gap-1 flow-box">
            <span className="flow-indicator flow-indicator--card" style={navIndicator} aria-hidden />
            {navItems.map((item, i) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/' || item.to === '/patients'}
                className={({ isActive }) => `sidebar-link anim-rise ${isActive ? 'active' : ''}`}
                style={{ animationDelay: `${110 + i * 45}ms` }}
              >
                <span className={`sidebar-icon sidebar-icon--${item.accent}`}><Icon name={item.icon} size={20} /></span>
                <span className="flex flex-col leading-tight min-w-0">
                  <span>{item.label}</span>
                  <span className="text-[10px] font-semibold text-[#8aa09c] truncate">{item.sub}</span>
                </span>
              </NavLink>
            ))}
          </nav>
        </div>

        {isDoctor ? (
          <div className="text-xs font-bold text-[#8aa09c] px-2 leading-relaxed">
            Кабинет врача{user?.name ? ` · ${user.name}` : ''}
          </div>
        ) : (
          <button className="btn btn-gold w-full anim-rise" style={{ animationDelay: '290ms' }} onClick={() => navigate('/new')}>
            <Icon name="pressure" size={16} /> Новый замер
          </button>
        )}
      </aside>

      {/* ---- Правая колонка ---- */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 bg-white/95 border-b border-[#e5e7eb]">
          <div className="px-5 sm:px-8 h-16 flex items-center gap-3 sm:gap-5">
            {/* Мобильный логотип */}
            <NavLink to="/" className="lg:hidden">
              <span className="wordmark !text-lg">Спектр-Диагностика</span>
            </NavLink>

            {/* Поиск по замерам / пациентам */}
            <form className="search-pill" onSubmit={submitSearch}>
              <Icon name="search" size={18} className="opacity-45" />
              <input
                type="text"
                placeholder={isDoctor ? 'Имя или email пациента…' : 'Поиск по замерам…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск"
              />
            </form>

            <div className="ml-auto flex items-center gap-1.5 sm:gap-2.5">
              {user?.role === 'doctor' && signalCount > 0 && (
                <span className="hidden lg:flex">
                  <button className="topbar-icon" title="Новые сигналы: требуются разборы"
                          aria-label="Сигналы" onClick={() => navigate('/patients')}>
                    <Icon name="alarm" size={20} />
                    <span className="absolute -top-0.5 -right-0.5 bg-coral text-white text-[10px] font-bold rounded-full px-1.5">{signalCount}</span>
                  </button>
                </span>
              )}
              <button className="topbar-icon" title="Уведомления" aria-label="Уведомления">
                <Icon name="bell" size={20} /><span className="dot" />
              </button>
              <button className="topbar-icon" title="Справка" aria-label="Справка">
                <Icon name="help" size={20} />
              </button>
              {isDoctor ? (
                <button
                  className="cursor-pointer bg-transparent border-none p-0"
                  title={`${user?.name || user?.email} · выйти`}
                  onClick={handleLogout}
                  aria-label="Профиль, выйти"
                >
                  <AvatarDoctor size={40} />
                </button>
              ) : (
                <button
                  className="doctor-avatar text-white cursor-pointer"
                  style={{ width: 40, height: 40 }}
                  title={`${user?.name || user?.email} · выйти`}
                  onClick={handleLogout}
                  aria-label="Профиль, выйти"
                >
                  <AvatarPatient size={33} />
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 sm:px-8 pt-7 pb-28 lg:pb-7 max-w-[1200px] w-full mx-auto">
          {/* Вход маршрута: контент страницы мягко проявляется при смене пути */}
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>

        <footer className="hidden lg:flex px-5 sm:px-8 py-7 flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-teal-dark/45">
            © 2026 {brand.name} · не заменяет консультацию врача
          </span>
          <span className="text-[11px] font-semibold text-teal-dark/45">
            {brand.site} · {brand.phone}
          </span>
        </footer>
      </div>

      {/* ---- Мобильная нижняя навигация: 5 равных колонок, Ассистент —
           в собственной средней ячейке, никого не перекрывает ---- */}
      <nav className="lg:hidden fixed bottom-4 left-0 right-0 z-40 px-4">
        <div ref={barRef} className="relative max-w-md mx-auto bg-white rounded-2xl glow-soft border border-[#e8eeed] grid grid-cols-5 items-center h-[70px] px-1 anim-rise" style={{ animationDelay: '120ms' }}>
          <span className="flow-indicator flow-indicator--bar" style={barIndicator} aria-hidden />
          {isDoctor ? (
            <>
              <BarLink to="/patients" label="Пациенты" icon="stethoscope" end />
              <BarLink to="/analytics" label="Аналитика" icon="chart" />
              <AssistantSlot />
              <BarLink to="/profile" label="Профиль" icon="profile" />
              <button
                className="justify-self-center flex flex-col items-center justify-center rounded-[10px] w-full max-w-[60px] px-0.5 py-1.5 transition-quick text-[10.5px] font-bold text-teal-dark hover:bg-teal-bg"
                onClick={() => navigate('/patients')}
                aria-label="Сигналы пациентов"
              >
                <span className="relative">
                  <Icon name="alarm" size={19} />
                  {signalCount > 0 && (
                    <span className="absolute -top-1.5 -right-2 bg-coral text-white text-[9px] font-bold rounded-full px-[5px]">
                      {signalCount}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 hidden min-[360px]:block">Сигналы</span>
              </button>
            </>
          ) : (
            <>
              <BarLink to="/" label="Дашборд" icon="home" end />
              <BarLink to="/medcard" label="Медкарта" icon="care" />
              <AssistantSlot />
              <BarLink to="/profile" label="Профиль" icon="profile" />
              <button
                className="justify-self-center flex flex-col items-center justify-center rounded-[10px] w-full max-w-[60px] px-0.5 py-1.5 transition-quick text-[10.5px] font-bold text-teal-dark hover:bg-teal-bg"
                onClick={() => navigate('/new')}
                aria-label="Новый замер"
              >
                <Icon name="pressure" size={19} />
                <span className="mt-0.5 hidden min-[360px]:block">Замер</span>
              </button>
            </>
          )}
        </div>
      </nav>

      {/* ---- Плавающая кнопка ИИ-помощника (desktop, как у Сбер Здоровья) ---- */}
      {!onChat && (
        <button className="ai-fab" onClick={() => navigate('/chat')} aria-label="Открыть чат с ИИ-помощником" title="ИИ-помощник">
          <Icon name="sparkle" size={22} />
        </button>
      )}
    </div>
  )
}
