import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'

export default function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { setUser } = useAuth()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const user = await api.register(email.trim(), password, name.trim())
      setUser(user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-10">
      <div className="text-center mb-8">
        <div className="wordmark" style={{ fontSize: 42 }}>
          Med<span className="text-gold-dark">AI</span>
        </div>
        <div className="wordmark-sub">Показатели под контролем</div>
      </div>

      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-xl p-6 glow-teal flex flex-col gap-4"
      >
        <h1 className="text-2xl text-center">Регистрация ✨</h1>

        {error && (
          <div className="badge badge-red justify-center normal-case tracking-normal">
            {error}
          </div>
        )}

        <div>
          <label className="flip-label" htmlFor="name">Имя</label>
          <input
            id="name"
            className="flip-input"
            placeholder="Как вас зовут?"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

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
          <label className="flip-label" htmlFor="password">Пароль (от 6 символов)</label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            className="flip-input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn btn-gold w-full" disabled={busy}>
          {busy ? 'Создаём…' : 'Создать аккаунт 🎉'}
        </button>

        <p className="text-center text-sm text-teal-dark/70">
          Уже есть аккаунт?{' '}
          <Link to="/login" className="font-extrabold text-teal hover:text-teal-light">
            Войти
          </Link>
        </p>
      </form>
    </div>
  )
}
