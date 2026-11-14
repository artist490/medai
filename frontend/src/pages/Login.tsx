import { FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { brand } from '../brand'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { user, loading, setUser } = useAuth()

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-teal-dark font-extrabold">Загрузка…</div>
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
    <div className="auth-bg min-h-screen flex flex-col items-center justify-center px-4 py-10">
      {/* Hero: логотип клиники */}
      <div className="text-center mb-8 auth-logo">
        <img src={brand.logo} alt={brand.name} style={{ maxWidth: 340, width: '100%' }} />
      </div>

      <form
        onSubmit={submit}
        className="auth-card w-full max-w-sm flex flex-col gap-4"
      >
        <h1 className="text-2xl text-center">Вход <Icon name="wave" size={22} className="inline-block align-[-3px]" /></h1>

        {error && (
          <div className="badge badge-red justify-center normal-case tracking-normal">
            {error}
          </div>
        )}

        <div>
          <label className="flip-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
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
            className="flip-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn btn-gold w-full" disabled={busy}>
          {busy ? 'Входим…' : (<span className="inline-flex items-center gap-2">Войти <Icon name="rocket" size={16} /></span>)}
        </button>

        <p className="text-center text-sm text-teal-dark/70">
          Ещё нет аккаунта?{' '}
          <Link to="/register" className="font-extrabold text-teal hover:text-teal-light">
            Зарегистрироваться
          </Link>
        </p>
      </form>

      <p className="text-center text-xs text-teal-dark/50 font-bold mt-4">
        {brand.name} · {brand.site} · не заменяет консультацию врача
      </p>
    </div>
  )
}
