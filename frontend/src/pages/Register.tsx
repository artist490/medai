import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { brand } from '../brand'
import type { Branch } from '../types'

export default function Register() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { user, loading, setUser } = useAuth()

  // Хуки — строго до условных выходов (Rules of Hooks): иначе у нового
  // посетителя (loading: true → false) порядок хуков меняется и React падает.
  useEffect(() => {
    api.fetchBranches().then((d) => setBranches(d.items)).catch(() => {})
  }, [])

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-teal-dark font-extrabold">Загрузка…</div>
  }
  if (user) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!branchId) {
      setError('Выберите филиал клиники')
      return
    }
    setBusy(true)
    try {
      const user = await api.register(email.trim(), password, name.trim(), inviteCode.trim() || undefined, Number(branchId))
      setUser(user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-bg min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="text-center mb-8 auth-logo anim-rise">
        <img src={brand.logo} alt={brand.name} style={{ maxWidth: 340, width: '100%' }} />
      </div>

      <form
        onSubmit={submit}
        className="auth-card w-full max-w-sm flex flex-col gap-4 anim-rise"
        style={{ animationDelay: '90ms' }}
      >
        <h1 className="text-2xl text-center">Регистрация</h1>

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

        <div>
          <label className="flip-label" htmlFor="branch">Филиал клиники</label>
          <select
            id="branch"
            required
            className="flip-input"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <option value="">Выберите город…</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.city}</option>
            ))}
          </select>
          <div className="flip-hint">Город ближайшего центра «Спектр-Диагностика».</div>
        </div>

        <div>
          <label className="flip-label" htmlFor="invite">Код приглашения (для сотрудников)</label>
          <input
            id="invite"
            type="text"
            className="flip-input"
            placeholder="Выдаёт администратор клиники"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
          />
          <div className="flip-hint">Есть у врачей клиники — превращает аккаунт в кабинет врача.</div>
        </div>

        <button className="btn btn-gold w-full" disabled={busy}>
          {busy ? 'Создаём…' : (<span className="inline-flex items-center gap-2">Создать аккаунт <Icon name="party" size={16} /></span>)}
        </button>

        <p className="text-center text-sm text-teal-dark/70">
          Уже есть аккаунт?{' '}
          <Link to="/login" className="font-extrabold text-teal hover:text-teal-light">
            Войти
          </Link>
        </p>
      </form>

      <p className="text-center text-xs text-teal-dark/50 font-bold mt-4">
        {brand.name} · {brand.site} · не заменяет консультацию врача
      </p>
    </div>
  )
}
