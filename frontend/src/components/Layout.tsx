// Каркас в стиле Flip7 SaaS: сайдбар слева, топбар с поиском, контент, футер.
// На мобильных сайдбар скрывается — остаётся нижняя pill-навигация.
// Навигация зависит от роли: пациент — личные вкладки, врач — кабинет пациентов.
import { FormEvent, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { brand } from '../brand'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const patientNav: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Обзор', icon: 'home' },
  { to: '/new', label: 'Замер', icon: 'stethoscope' },
  { to: '/chat', label: 'Чат ИИ', icon: 'robot' },
  { to: '/history', label: 'История', icon: 'chart' },
  { to: '/profile', label: 'Профиль', icon: 'profile' },
]

const doctorNav: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/patients', label: 'Пациенты', icon: 'chart' },
  { to: '/chat', label: 'Чат ИИ', icon: 'robot' },
  { to: '/profile', label: 'Профиль', icon: 'profile' },
]

function initialsOf(name: string, email: string): string {
  const base = (name || email || '?').trim()
  if (!base.includes('@')) {
    const parts = base.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return base.slice(0, 2).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase()
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const isDoctor = user?.role === 'doctor'
  const navItems = isDoctor ? doctorNav : patientNav

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `${isDoctor ? '/patients' : '/history'}?q=${encodeURIComponent(q)}` : (isDoctor ? '/patients' : '/history'))
  }

  return (
    <div className="min-h-screen lg:grid" style={{ gridTemplateColumns: '250px 1fr' }}>
      {/* ---- Сайдбар (desktop) ---- */}
      <aside className="hidden lg:flex flex-col justify-between sticky top-0 h-screen bg-panel-dark px-5 py-7">
        <div>
          <NavLink to="/" className="block px-2">
            <div className="wordmark" style={{ color: '#8fd6d0' }}>
              Спектр<span className="text-coral">-</span>Диагностика
            </div>
            <div className="wordmark-sub" style={{ color: '#ff8a70' }}>{brand.subtitle}</div>
          </NavLink>

          <nav className="mt-10 flex flex-col gap-1.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/' || item.to === '/patients'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                <span className="sidebar-icon"><Icon name={item.icon} size={22} /></span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        {isDoctor ? (
          <div className="text-xs font-bold text-white/50 px-2 leading-relaxed">
            Кабинет врача{user?.name ? ` · ${user.name}` : ''}
          </div>
        ) : (
          <button className="btn btn-on-dark w-full" onClick={() => navigate('/new')}>
            + Новый замер
          </button>
        )}
      </aside>

      {/* ---- Правая колонка ---- */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 bg-[#f4f7f6]/85 backdrop-blur border-b border-[#e8eeed]">
          <div className="px-5 sm:px-8 h-16 flex items-center gap-3 sm:gap-5">
            {/* Мобильный логотип */}
            <NavLink to="/" className="lg:hidden">
              <span className="wordmark !text-lg" style={{ color: 'var(--color-teal)' }}>Спектр-Диагностика</span>
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
              <button
                className="avatar-circle"
                title={`${user?.name || user?.email} · выйти`}
                onClick={handleLogout}
                aria-label="Профиль, выйти"
              >
                {initialsOf(user?.name ?? '', user?.email ?? '')}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 sm:px-8 pt-7 pb-28 lg:pb-7 max-w-[1200px] w-full mx-auto">
          <Outlet />
        </main>

        <footer className="hidden lg:flex px-5 sm:px-8 py-7 flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] font-extrabold uppercase tracking-[2px] text-teal-dark/40">
            © 2026 {brand.name} · не заменяет консультацию врача
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-[2px] text-teal-dark/40">
            {brand.site} · {brand.phone}
          </span>
        </footer>
      </div>

      {/* ---- Мобильная нижняя навигация ---- */}
      <nav className="lg:hidden fixed bottom-4 left-0 right-0 z-40 px-4">
        <div className="max-w-md mx-auto bg-white rounded-2xl px-2 py-1.5 flex justify-around glow-soft border border-[#e8eeed]">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/' || item.to === '/patients'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center rounded-[10px] min-w-[56px] py-1.5 px-2 transition-quick text-[11px] font-bold ${
                  isActive
                    ? 'bg-teal text-white shadow-sm'
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
    </div>
  )
}
