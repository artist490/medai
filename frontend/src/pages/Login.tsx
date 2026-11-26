import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { brand } from '../brand'
import AuthAside from '../components/AuthAside'
import BrandLockup from '../components/BrandLockup'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { user, loading, setUser } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-sm text-ink-soft" role="status">Загрузка…</div>
      </div>
    )
  }
  if (user) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const user = await api.login(email.trim(), password)
      setUser(user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка входа')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <div className="auth-form">
          <div className="auth-brand">
            <BrandLockup />
          </div>

          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Вход в личный кабинет</h1>
            <p className="text-[13px] text-ink-soft mt-1">
              Дневник показателей, медкарта и разборы от врача клиники.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4 mt-2">
            {error && (
              <div
                role="alert"
                className="text-[12.5px] text-coral-dark bg-[#fbf1f0] border border-[#e8cfcc] rounded-md px-3 py-2"
              >
                {error}
              </div>
            )}

            <div>
              <label className="flip-label" htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="flip-input"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="flip-label" htmlFor="password">Пароль</label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                className="flip-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button className="btn btn-gold w-full mt-1" disabled={busy}>
              {busy ? 'Входим…' : 'Войти'}
              {!busy && <Icon name="arrow" size={15} />}
            </button>
          </form>

          <p className="text-[13px] text-ink-soft">
            Нет аккаунта?{' '}
            <Link to="/register" className="text-teal-dark font-medium hover:underline underline-offset-2">
              Зарегистрироваться
            </Link>
          </p>

          <p className="auth-foot">
            {brand.name} · {brand.site}
            <br />
            Сервис не заменяет консультацию врача.
          </p>
        </div>
      </div>

      <AuthAside />
    </div>
  )
}
