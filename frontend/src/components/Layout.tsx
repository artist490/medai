// Каркас приложения: постоянный сайдбар на десктопе, нижняя навигация
// на телефоне, тонкий топбар с поиском. Никаких плавающих карточек и
// цветных иконок — только структура, линии и один акцентный цвет.
import { FormEvent, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useFlowIndicatorStyle, useFlowRect } from './useFlowRect'
import * as api from '../api'
import { useAuth } from '../auth'
import { brand } from '../brand'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import type { NotificationItem } from '../types'
import AvatarDoctor from './AvatarDoctor'
import AvatarPatient from './AvatarPatient'

type NavItem = { to: string; label: string; icon: IconName }

// Иконка элемента колокольчика по типу уведомления (Б2)
const NOTIF_ICON: Record<NotificationItem['type'], IconName> = {
  note: 'doc',
  visit_done: 'check',
  visit_tomorrow: 'calendar',
  signal: 'alarm',
}

const patientNav: NavItem[] = [
  { to: '/', label: 'Обзор', icon: 'home' },
  { to: '/medcard', label: 'Медкарта', icon: 'care' },
  { to: '/chat', label: 'Ассистент', icon: 'sparkle' },
  { to: '/profile', label: 'Профиль', icon: 'profile' },
]

const doctorNav: NavItem[] = [
  { to: '/patients', label: 'Пациенты', icon: 'stethoscope' },
  { to: '/analytics', label: 'Аналитика', icon: 'chart' },
  { to: '/chat', label: 'Ассистент', icon: 'sparkle' },
  { to: '/profile', label: 'Профиль', icon: 'profile' },
]

// Русские склонения возраста: 31 год, 34 года, 40 лет
function ageWord(age: number): string {
  const mod10 = age % 10
  const mod100 = age % 100
  if (mod10 === 1 && mod100 !== 11) return 'год'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'года'
  return 'лет'
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden>
      <svg width="18" height="18" viewBox="0 0 18 18">
        <circle cx="9" cy="9" r="3.4" />
        <circle cx="9" cy="9" r="7" />
      </svg>
    </span>
  )
}

// Пункт нижней панели: подложка — общий перетекающий индикатор
function BarLink({ to, label, icon, end }: {
  to: string; label: string; icon: IconName; end?: boolean
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({ isActive }) =>
        `bar-link flex flex-col items-center justify-center gap-1 h-full w-full transition-quick text-[10.5px] font-medium ${
          isActive ? 'active text-teal-deep' : 'text-[#6a7772]'
        }`
      }
    >
      <Icon name={icon} size={19} />
      <span className="whitespace-nowrap">{label}</span>
    </NavLink>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  // Колокольчик (Б1): у пациента — заметки врача, завершённые приёмы, приём
  // завтра; у врача — непрочитанные сигналы, как раньше. Один эндпоинт.
  const [notif, setNotif] = useState<{ unread: number; items: NotificationItem[] }>({ unread: 0, items: [] })
  const [notifOpen, setNotifOpen] = useState(false)
  const notifButtonRef = useRef<HTMLButtonElement>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!user) return
    const load = () => api.fetchNotifications().then(setNotif).catch(() => {})
    load()
    // Обновляется само: новая заметка врача или красный замер — без перезагрузки
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [user])
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  // Меню аватара и колокольчик закрываются при смене маршрута
  useEffect(() => { setUserMenuOpen(false); setNotifOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!userMenuOpen && !notifOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setUserMenuOpen(false)
      setNotifOpen(false)
      userMenuButtonRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [userMenuOpen, notifOpen])
  // Перетекающий индикатор активного пункта: сайдбар и мобильный бар
  const navRef = useRef<HTMLElement>(null)
  const navRect = useFlowRect(navRef, '.sidebar-link.active', location.pathname)
  const navIndicator = useFlowIndicatorStyle(navRect)
  const barRef = useRef<HTMLDivElement>(null)
  const barRect = useFlowRect(barRef, '.bar-link.active', location.pathname)
  const barIndicator = useFlowIndicatorStyle(barRect)
  const isDoctor = user?.role === 'doctor'
  const navItems = isDoctor ? doctorNav : patientNav

  async function handleLogout() {
    if (!window.confirm('Выйти из аккаунта?')) return
    await logout()
    navigate('/login')
  }

  function openNotifs() {
    const next = !notifOpen
    setNotifOpen(next)
    // Открыл список → просмотрено. У пациента счётчик сбросится сразу;
    // у врача сигналы закрываются разбором красного замера, «как сейчас».
    if (next && notif.unread > 0) {
      api.markNotificationsSeen().catch(() => {})
        .finally(() => { api.fetchNotifications().then(setNotif).catch(() => {}) })
    }
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    navigate(q ? `${isDoctor ? '/patients' : '/medcard?tab=meas'}${isDoctor ? '?' : '&'}q=${encodeURIComponent(q)}` : (isDoctor ? '/patients' : '/medcard?tab=meas'))
  }

  return (
    <div className="min-h-screen lg:grid" style={{ gridTemplateColumns: '248px 1fr' }}>
      <a href="#main-content" className="skip-link">Перейти к основному содержимому</a>

      {/* ---- Сайдбар (desktop) ---- */}
      <aside className="hidden lg:flex flex-col justify-between sticky top-0 h-screen sidebar-shell border-r border-line px-4 py-5">
        <div>
          <NavLink to="/" className="flex items-start gap-2.5 px-2 py-1">
            <BrandMark />
            <div className="min-w-0">
              <div className="text-[14.5px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink">
                {brand.name}
              </div>
              <div className="text-[9.5px] uppercase tracking-[0.06em] text-ink-soft mt-1 leading-[1.35]">
                {brand.subtitle}
              </div>
            </div>
          </NavLink>

          {/* Текущий пользователь: строка, а не парящая карточка */}
          <NavLink
            to="/profile"
            className="mt-5 flex items-center gap-2.5 border-y border-line px-2 py-3 hover:bg-[#f7f9f8] transition-quick"
          >
            {isDoctor ? (
              <AvatarDoctor size={30} />
            ) : (
              <span className="doctor-avatar text-white" style={{ width: 30, height: 30 }}>
                <AvatarPatient size={24} />
              </span>
            )}
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink truncate">{user?.name || user?.email}</div>
              <div className="text-[11.5px] text-ink-soft truncate">
                {user?.age ? `${user.age} ${ageWord(user.age)}` : (isDoctor ? 'врач клиники' : 'пациент')}
              </div>
            </div>
          </NavLink>

          <nav ref={navRef} className="mt-3 flex flex-col gap-0.5 flow-box">
            <span className="flow-indicator flow-indicator--card" style={navIndicator} aria-hidden />
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/' || item.to === '/patients'}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              >
                <span className="sidebar-icon"><Icon name={item.icon} size={18} /></span>
                <span className="truncate">{item.label}</span>
                {item.to === '/patients' && notif.unread > 0 && (
                  <span className="ml-auto text-[11px] font-medium text-coral-dark tabular-nums">
                    {notif.unread}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-3">
          {isDoctor ? (
            <p className="text-[11.5px] text-ink-soft leading-relaxed px-2">
              {brand.name}
              <br />
              {brand.phone}
            </p>
          ) : (
            <button className="btn btn-gold w-full" onClick={() => navigate('/new')}>
              <Icon name="pressure" size={16} /> Новый замер
            </button>
          )}
        </div>
      </aside>

      {/* ---- Правая колонка ---- */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-40 bg-white border-b border-line">
          <div className="px-5 sm:px-8 h-14 flex items-center gap-4">
            {/* Мобильный логотип */}
            <NavLink to="/" className="lg:hidden flex items-center gap-2">
              <BrandMark />
              <span className="wordmark">Спектр</span>
            </NavLink>

            {/* Поиск по замерам / пациентам */}
            <form className="search-pill" onSubmit={submitSearch}>
              <Icon name="search" size={16} className="opacity-45" />
              <input
                type="text"
                placeholder={isDoctor ? 'Имя или email пациента…' : 'Поиск по замерам…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск"
              />
            </form>

            <div className="ml-auto flex items-center gap-1">
              {/* Колокольчик (Б2): бейдж с числом и выпадающий список, клик ведёт к цели */}
              <div className="relative">
                <button
                  className="topbar-icon"
                  ref={notifButtonRef}
                  title="Уведомления"
                  aria-label="Уведомления"
                  aria-haspopup="menu"
                  aria-expanded={notifOpen}
                  onClick={openNotifs}
                >
                  <Icon name="bell" size={19} />
                  {notif.unread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-coral text-white text-[10px] font-semibold leading-4 tabular-nums text-center" aria-hidden>
                      {notif.unread > 9 ? '9+' : notif.unread}
                    </span>
                  )}
                </button>
                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-40 cursor-default" onClick={() => setNotifOpen(false)} aria-hidden />
                    <div
                      role="menu"
                      aria-label="Уведомления"
                      className="absolute right-0 top-[40px] z-50 w-[320px] max-w-[calc(100vw-24px)] bg-white border border-line rounded-lg shadow-float p-1 flex flex-col"
                    >
                      <div className="text-[12px] font-semibold text-ink-soft uppercase tracking-[0.04em] px-3 pt-2 pb-1">
                        Уведомления
                      </div>
                      {notif.items.length === 0 ? (
                        <p className="text-[13px] text-ink-soft px-3 py-4">Пока ничего нового</p>
                      ) : (
                        notif.items.map((item) => (
                          <button
                            key={item.id}
                            role="menuitem"
                            className="text-left px-3 py-2.5 rounded hover:bg-[#f4f6f5] transition-quick flex items-start gap-2.5"
                            onClick={() => { setNotifOpen(false); navigate(item.target) }}
                          >
                            <Icon name={NOTIF_ICON[item.type] ?? 'bell'} size={15} className="mt-0.5 text-teal-dark shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-[13px] text-ink leading-snug">{item.text}</span>
                              <span className="block text-[11px] text-ink-soft tabular-nums mt-0.5">
                                {item.created_at.slice(0, 16).replace('T', ' ')}
                              </span>
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* Аватар: меню профиля (профиль / выход) вместо мгновенного logout */}
              <div className="relative">
                {isDoctor ? (
                  <button
                    className="cursor-pointer bg-transparent border-none p-0 flex"
                    ref={userMenuButtonRef}
                    id="profile-menu-button"
                    onClick={() => setUserMenuOpen((v) => !v)}
                    aria-label="Меню профиля"
                    aria-haspopup="menu"
                    aria-controls="profile-menu"
                    aria-expanded={userMenuOpen}
                  >
                    <AvatarDoctor size={32} />
                  </button>
                ) : (
                  <button
                    className="doctor-avatar text-white cursor-pointer border-none p-0"
                    style={{ width: 32, height: 32 }}
                    ref={userMenuButtonRef}
                    id="profile-menu-button"
                    onClick={() => setUserMenuOpen((v) => !v)}
                    aria-label="Меню профиля"
                    aria-haspopup="menu"
                    aria-controls="profile-menu"
                    aria-expanded={userMenuOpen}
                  >
                    <AvatarPatient size={26} />
                  </button>
                )}
                {userMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40 cursor-default" onClick={() => setUserMenuOpen(false)} aria-hidden />
                    <div
                      id="profile-menu"
                      role="menu"
                      aria-labelledby="profile-menu-button"
                      className="absolute right-0 top-[40px] z-50 w-48 bg-white border border-line rounded-lg shadow-float p-1 flex flex-col"
                    >
                      <button
                        role="menuitem"
                        className="text-left text-[13px] text-ink px-3 py-2 rounded hover:bg-[#f4f6f5] transition-quick"
                        onClick={() => { setUserMenuOpen(false); navigate('/profile') }}
                      >
                        Профиль
                      </button>
                      <button
                        role="menuitem"
                        className="text-left text-[13px] text-ink px-3 py-2 rounded hover:bg-[#f4f6f5] transition-quick"
                        onClick={handleLogout}
                      >
                        Выйти
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-5 sm:px-8 pt-6 pb-24 lg:pb-10 max-w-[1120px] w-full mx-auto"
        >
          <div key={location.pathname} className="page-enter">
            <Outlet />
          </div>
        </main>

        <footer className="hidden lg:flex px-5 sm:px-8 py-6 mt-4 border-t border-line flex-wrap items-center justify-between gap-2">
          <span className="text-[11.5px] text-ink-soft">
            © 2026 {brand.name} · не заменяет консультацию врача
          </span>
          <span className="text-[11.5px] text-ink-soft">
            {brand.site} · {brand.phone}
          </span>
        </footer>
      </div>

      {/* ---- Мобильная нижняя навигация ---- */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-line">
        <div ref={barRef} className="relative grid grid-cols-5 h-[58px] flow-box">
          <span className="flow-indicator flow-indicator--bar" style={barIndicator} aria-hidden />
          {isDoctor ? (
            <>
              <BarLink to="/patients" label="Пациенты" icon="stethoscope" end />
              <BarLink to="/analytics" label="Аналитика" icon="chart" />
              <BarLink to="/chat" label="Ассистент" icon="sparkle" />
              <BarLink to="/profile" label="Профиль" icon="profile" />
              <button
                className="bar-link flex flex-col items-center justify-center gap-1 h-full w-full transition-quick text-[10.5px] font-medium text-[#6a7772]"
                onClick={() => navigate('/patients')}
                aria-label="Сигналы пациентов"
              >
                <span className="relative">
                  <Icon name="alarm" size={19} />
                  {notif.unread > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-coral text-white text-[9px] font-semibold leading-[14px] tabular-nums text-center" aria-hidden>
                      {notif.unread > 9 ? '9+' : notif.unread}
                    </span>
                  )}
                </span>
                <span className="whitespace-nowrap">Сигналы</span>
              </button>
            </>
          ) : (
            <>
              <BarLink to="/" label="Обзор" icon="home" end />
              <BarLink to="/medcard" label="Медкарта" icon="care" />
              <BarLink to="/chat" label="Ассистент" icon="sparkle" />
              <BarLink to="/profile" label="Профиль" icon="profile" />
              <button
                className="bar-link flex flex-col items-center justify-center gap-1 h-full w-full transition-quick text-[10.5px] font-medium text-[#6a7772]"
                onClick={() => navigate('/new')}
                aria-label="Новый замер"
              >
                <Icon name="pressure" size={19} />
                <span className="whitespace-nowrap">Замер</span>
              </button>
            </>
          )}
        </div>
      </nav>
    </div>
  )
}
