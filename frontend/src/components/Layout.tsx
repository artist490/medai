// Каркас в стиле Flip7 SaaS: сайдбар слева, топбар с поиском, контент, футер.
// На мобильных сайдбар скрывается — остаётся нижняя pill-навигация.
import { FormEvent, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const navItems: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/', label: 'Обзор', icon: 'home' },
  { to: '/new', label: 'Замер', icon: 'stethoscope' },
  { to: '/history', label: 'История', icon: 'chart' },
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

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `/history?q=${encodeURIComponent(q)}` : '/history')
  }

  return (
    <div className="min-h-screen lg:grid" style={{ gridTemplateColumns: '250px 1fr' }}>
      {/* ---- Сайдбар (desktop) ---- */}
      <aside className="hidden lg:flex flex-col justify-between sticky top-0 h-screen bg-surface border-r-4 border-white px-5 py-7">
        <div>
          <NavLink to="/" className="block px-2">
            <div className="wordmark">Med<span className="text-gold-dark">AI</span></div>
            <div className="wordmark-sub">Показатели под контролем</div>
          </NavLink>

          <nav className="mt-10 flex flex-col gap-1.5">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                <span className="sidebar-icon"><Icon name={item.icon} size={22} /></span>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <button className="btn btn-teal w-full" onClick={() => navigate('/new')}>
          + Новый замер
        </button>
      </aside>

      {/* ---- Правая колонка ---- */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur">
          <div className="px-5 sm:px-8 h-16 flex items-center gap-3 sm:gap-5">
            {/* Мобильный логотип */}
            <NavLink to="/" className="lg:hidden">
              <span className="wordmark !text-lg">Med<span className="text-gold-dark">AI</span></span>
            </NavLink>

            {/* Поиск по замерам */}
            <form className="search-pill" onSubmit={submitSearch}>
              <Icon name="search" size={18} className="opacity-45" />
              <input
                type="text"
                placeholder="Поиск по замерам…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск по замерам"
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
            © 2026 MedAI · не заменяет консультацию врача
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-[2px] text-teal-dark/40">
            правила · приватность · api
          </span>
        </footer>
      </div>

      {/* ---- Мобильная нижняя навигация ---- */}
      <nav className="lg:hidden fixed bottom-4 left-0 right-0 z-40 px-4">
        <div className="max-w-md mx-auto bg-white rounded-full px-2 py-2 flex justify-between glow-teal">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center rounded-full min-w-[70px] py-1.5 px-3 transition-quick text-[11px] font-extrabold tracking-wide ${
                  isActive
                    ? 'bg-teal text-white glow-teal scale-105'
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
