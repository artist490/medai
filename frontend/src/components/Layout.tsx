// Каркас в стиле Flip7 SaaS: сайдбар слева, топбар с поиском, контент, футер.
// На мобильных сайдбар скрывается — остаётся нижняя pill-навигация.
// Навигация зависит от роли: пациент — личные вкладки, врач — кабинет пациентов.
// Сайдбар как у Сбер Здоровья: профиль-блок, пункты с подписями и цветными
// акцентами иконок (teal/коралл/небо/золото — статусная семантика сохранена).
import { FormEvent, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
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
  { to: '/chat', label: 'Чат ИИ', sub: 'Ассистент клиники', icon: 'robot', accent: 'sky' },
  { to: '/profile', label: 'Профиль', sub: 'Личные данные', icon: 'profile', accent: 'gold' },
]

const doctorNav: NavItem[] = [
  { to: '/patients', label: 'Пациенты', sub: 'Кабинет врача', icon: 'chart', accent: 'teal' },
  { to: '/chat', label: 'Чат ИИ', sub: 'Ассистент врача', icon: 'robot', accent: 'sky' },
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

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
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
          <NavLink to="/" className="block px-2">
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
          <div className="profile-card mt-7 flex items-center gap-3 px-3 py-3">
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

          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/' || item.to === '/patients'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
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
          <button className="btn btn-gold w-full" onClick={() => navigate('/new')}>
            <Icon name="pressure" size={16} /> Новый замер
          </button>
        )}
      </aside>

      {/* ---- Правая колонка ---- */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-[#e5e7eb]">
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
          <Outlet />
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

      {/* ---- FAB замера (мобильный, пациент); на странице чата скрыт —
           освобождает место композеру ввода ---- */}
      {!isDoctor && !onChat && (
        <button
          className="fab-mobile fixed bottom-[86px] left-1/2 -translate-x-1/2 z-40 btn btn-gold rounded-full !min-h-[52px] !px-5 shadow-[0_6px_18px_rgba(23,46,42,0.25)]"
          onClick={() => navigate('/new')}
          aria-label="Новый замер"
        >
          + Новый замер
        </button>
      )}

      {/* ---- Мобильная нижняя навигация ---- */}
      <nav className="lg:hidden fixed bottom-4 left-0 right-0 z-40 px-4">
        <div className="max-w-md mx-auto bg-white rounded-2xl px-2 py-1.5 flex justify-around glow-soft border border-[#e8eeed]">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/' || item.to === '/patients'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center rounded-[10px] min-w-[70px] py-1.5 px-3 transition-quick text-[11px] font-bold ${
                  isActive
                    ? 'bg-teal-dark text-white shadow-sm'
                    : 'text-teal-dark hover:bg-teal-bg'
                }`
              }
            >
              <Icon name={item.icon} size={18} />
              <span className="mt-0.5">{item.label}</span>
            </NavLink>
          ))}
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
