import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import * as api from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { Skeleton } from '../components/Skeleton'
import { brand } from '../brand'
import AuthAside from '../components/AuthAside'
import BrandLockup from '../components/BrandLockup'
import type { Branch } from '../types'

export default function Register() {
  const [lastName, setLastName] = useState('')
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchId] = useState('')
  const [branchesLoading, setBranchesLoading] = useState(true)
  const [branchesError, setBranchesError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { user, loading, setUser } = useAuth()

  // Хуки — строго до условных выходов (Rules of Hooks)
  function loadBranches() {
    setBranchesLoading(true)
    setBranchesError('')
    api.fetchBranches()
      .then((d) => setBranches(d.items))
      .catch(() => setBranchesError('Не удалось загрузить список филиалов'))
      .finally(() => setBranchesLoading(false))
  }

  useEffect(() => {
    loadBranches()
  }, [])

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
    if (!lastName.trim() || !firstName.trim()) {
      setError('Укажите фамилию и имя')
      return
    }
    if (!branchId) {
      setError('Выберите филиал клиники')
      return
    }
    setBusy(true)
    try {
      const user = await api.register(
        email.trim(), password,
        firstName.trim(), lastName.trim(), middleName.trim(),
        inviteCode.trim() || undefined, Number(branchId), phone.trim() || undefined,
      )
      setUser(user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации')
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
            <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Создать аккаунт</h1>
            <p className="text-[13px] text-ink-soft mt-1">
              Привяжем вас к филиалу — нормы и врачи будут из вашего города.
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flip-label" htmlFor="last-name">Фамилия</label>
                <input
                  id="last-name"
                  className="flip-input"
                  required
                  autoComplete="family-name"
                  placeholder="Иванов"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
              <div>
                <label className="flip-label" htmlFor="first-name">Имя</label>
                <input
                  id="first-name"
                  className="flip-input"
                  required
                  autoComplete="given-name"
                  placeholder="Иван"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="flip-label" htmlFor="middle-name">
                Отчество <span className="text-ink-soft font-normal">(если есть)</span>
              </label>
              <input
                id="middle-name"
                className="flip-input"
                autoComplete="additional-name"
                placeholder="Иванович"
                value={middleName}
                onChange={(e) => setMiddleName(e.target.value)}
              />
            </div>

            <div>
              <label className="flip-label" htmlFor="phone">
                Телефон <span className="text-ink-soft font-normal">(если хотите, чтобы филиал мог позвонить)</span>
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                className="flip-input"
                placeholder="+7 (___) ___-__-__"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

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
                minLength={12}
                autoComplete="new-password"
                className="flip-input"
                placeholder="Не короче 12 символов"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="flip-hint">Минимум 12 символов.</div>
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
                <option value="">Выберите город</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.city}</option>
                ))}
              </select>
              {branchesLoading && (
                <div className="flex items-center gap-2 mt-2" aria-busy>
                  <Skeleton w={80} h={10} />
                  <span className="text-[11.5px] text-ink-soft">Загружаем филиалы…</span>
                </div>
              )}
              {branchesError && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-coral-dark">{branchesError}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={loadBranches}>Повторить</button>
                </div>
              )}
            </div>

            <div>
              <label className="flip-label" htmlFor="invite">
                Код приглашения <span className="text-ink-soft font-normal">(для сотрудников)</span>
              </label>
              <input
                id="invite"
                type="text"
                className="flip-input"
                placeholder="Выдаёт администратор клиники"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
              <div className="flip-hint">С ним аккаунт станет кабинетом врача.</div>
            </div>

            <button className="btn btn-gold w-full mt-1" disabled={busy}>
              {busy ? 'Создаём…' : 'Создать аккаунт'}
              {!busy && <Icon name="arrow" size={15} />}
            </button>
          </form>

          <p className="text-[13px] text-ink-soft">
            Уже есть аккаунт?{' '}
            <Link to="/login" className="text-teal-dark font-medium hover:underline underline-offset-2">
              Войти
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
