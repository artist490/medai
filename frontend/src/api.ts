// API-клиент: bearer-токен в localStorage, единая обработка ошибок.
import type { Measurement, Stats, User } from './types'

const TOKEN_KEY = 'medai_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const resp = await fetch(path, { ...options, headers })

  if (resp.status === 204) return undefined as T
  const body = await resp.json().catch(() => ({}))

  if (!resp.ok) {
    if (resp.status === 401) {
      setToken(null)
      window.dispatchEvent(new Event('medai:unauthorized'))
    }
    throw new ApiError(resp.status, body.detail || `Ошибка ${resp.status}`)
  }
  return body as T
}

// ---------- auth ----------

export async function register(email: string, password: string, name: string) {
  const data = await request<{ token: string; user: User }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  })
  setToken(data.token)
  return data.user
}

export async function login(email: string, password: string) {
  const data = await request<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  setToken(data.token)
  return data.user
}

export async function logout() {
  await request('/api/auth/logout', { method: 'POST' }).catch(() => {})
  setToken(null)
}

export async function fetchMe(): Promise<User> {
  return request<User>('/api/auth/me')
}

export async function updateProfile(patch: Partial<User>): Promise<User> {
  return request<User>('/api/auth/me', { method: 'PUT', body: JSON.stringify(patch) })
}

// ---------- measurements ----------

export interface MeasurementInput {
  systolic?: number | null
  diastolic?: number | null
  pulse?: number | null
  temperature?: number | null
  spo2?: number | null
  sleep_hours?: number | null
  steps?: number | null
  water_ml?: number | null
  weight_kg?: number | null
}

export async function createMeasurement(input: MeasurementInput): Promise<Measurement> {
  return request<Measurement>('/api/measurements', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function listMeasurements(limit = 50, offset = 0) {
  return request<{ items: Measurement[]; total: number }>(
    `/api/measurements?limit=${limit}&offset=${offset}`,
  )
}

export async function getMeasurement(id: number | string): Promise<Measurement> {
  return request<Measurement>(`/api/measurements/${id}`)
}

export async function deleteMeasurement(id: number): Promise<void> {
  return request<void>(`/api/measurements/${id}`, { method: 'DELETE' })
}

export async function fetchStats(): Promise<Stats> {
  return request<Stats>('/api/stats')
}

export async function fetchHealth(): Promise<{ ok: boolean; llm_enabled: boolean }> {
  return request('/api/health')
}
