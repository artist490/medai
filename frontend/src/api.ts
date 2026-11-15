// API-клиент: bearer-токен в localStorage, единая обработка ошибок.
import type { Branch, BranchAnalytics, ChatMessage, DoctorNote, DocumentItem, DoctorSignal, Goals, Measurement, MedCard, MedCardInput, PatientRow, Stats, User, Visit } from './types'

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

export async function register(
  email: string, password: string, name: string,
  inviteCode?: string, branchId?: number,
) {
  const data = await request<{ token: string; user: User }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      name,
      ...(inviteCode ? { invite_code: inviteCode } : {}),
      ...(branchId ? { branch_id: branchId } : {}),
    }),
  })
  setToken(data.token)
  return data.user
}

export async function fetchBranches(): Promise<{ items: Branch[] }> {
  return request('/api/auth/branches')
}

export async function fetchMe(): Promise<User> {
  return request<User>('/api/auth/me')
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

export async function updateProfile(
  patch: Partial<User> & { branch_id?: number | null },
): Promise<User> {
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
  period?: 'morning' | 'evening'
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

// ---------- кабинет врача ----------

export async function fetchPatients(): Promise<{ items: PatientRow[] }> {
  return request('/api/doctor/patients')
}

export async function fetchPatient(id: number | string): Promise<{ patient: User; items: Measurement[] }> {
  return request(`/api/doctor/patients/${id}`)
}

export async function addDoctorNote(analysisId: number, text: string): Promise<DoctorNote> {
  return request(`/api/doctor/analyses/${analysisId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

// ---------- медкарта ----------

export async function fetchMedCard(): Promise<MedCard> {
  return request('/api/medcard')
}

export async function updateMedCard(patch: MedCardInput): Promise<MedCard> {
  return request('/api/medcard', { method: 'PUT', body: JSON.stringify(patch) })
}

export async function fetchPatientMedCard(patientId: number | string): Promise<MedCard> {
  return request(`/api/medcard/patient/${patientId}`)
}

export async function updatePatientMedCard(
  patientId: number | string, patch: MedCardInput,
): Promise<MedCard> {
  return request(`/api/medcard/patient/${patientId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

// ---------- приёмы ----------

export interface VisitInput {
  visit_date?: string
  reason?: string
  complaints: string
}

export async function createVisit(input: VisitInput): Promise<Visit> {
  return request('/api/visits', { method: 'POST', body: JSON.stringify(input) })
}

export async function fetchMyVisits(): Promise<{ items: Visit[] }> {
  return request('/api/visits/mine')
}

export async function patchVisit(id: number, patch: Partial<VisitInput>): Promise<Visit> {
  return request(`/api/visits/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function cancelVisit(id: number): Promise<Visit> {
  return request(`/api/visits/${id}/cancel`, { method: 'POST' })
}

export async function fetchPatientVisits(patientId: number | string): Promise<{ items: Visit[] }> {
  return request(`/api/doctor/patients/${patientId}/visits`)
}

export async function completeVisit(
  id: number, conclusion: string, recommendations: string,
): Promise<Visit> {
  return request(`/api/doctor/visits/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ conclusion, recommendations }),
  })
}

// ---------- ИИ-сводка пациента ----------

export async function fetchPatientSummary(patientId: number | string): Promise<{ summary: string }> {
  return request(`/api/doctor/patients/${patientId}/summary`, { method: 'POST' })
}

// ---------- чат с ИИ-ассистентом ----------

export interface ChatReply {
  reply: string
  tools_used: string[]
  model: string
}

export async function sendChat(message: string): Promise<ChatReply> {
  return request('/api/chat/send', { method: 'POST', body: JSON.stringify({ message }) })
}

export async function fetchChatHistory(): Promise<{ items: ChatMessage[] }> {
  return request('/api/chat/history')
}

export async function clearChat(): Promise<void> {
  return request<void>('/api/chat', { method: 'DELETE' })
}

// ---------- цели пациента ----------

export async function fetchGoals(): Promise<Goals> {
  return request('/api/goals')
}

export async function saveGoals(patch: Partial<Goals>): Promise<Goals> {
  return request('/api/goals', { method: 'PUT', body: JSON.stringify(patch) })
}

// ---------- дневник ----------

export async function repeatLastMeasurement(period: 'morning' | 'evening'): Promise<Measurement> {
  return request(`/api/measurements/repeat?period=${period}`, { method: 'POST' })
}

// ---------- документы ----------

export async function uploadDocument(file: File, title: string): Promise<DocumentItem> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('title', title)
  return request('/api/documents', { method: 'POST', body: fd })
}

export async function fetchDocuments(): Promise<{ items: DocumentItem[] }> {
  return request('/api/documents')
}

export async function deleteDocument(id: number): Promise<void> {
  return request<void>(`/api/documents/${id}`, { method: 'DELETE' })
}

// ---------- сигналы и аналитика врача ----------

export async function fetchSignals(): Promise<{ unread: number; items: DoctorSignal[] }> {
  return request('/api/doctor/signals')
}

export async function markSignalSeen(analysisId: number): Promise<void> {
  return request(`/api/doctor/analyses/${analysisId}/seen`, { method: 'POST' })
}

export async function fetchAnalytics(): Promise<BranchAnalytics> {
  return request('/api/analytics')
}
