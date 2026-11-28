// API-клиент: HttpOnly-сессия + CSRF; Bearer не хранится в браузерном storage.
import type { Branch, BranchAnalytics, ChatMessage, DoctorNote, DoctorNoteItem, DoctorOrder, DocumentItem, DoctorSignal, Goals, LabTrendPoint, Measurement, MedCard, MedCardInput, NotificationItem, OcrResult, PatientRow, Stats, SymptomNote, User, Visit } from './types'

const TOKEN_KEY = 'medai_token'

function getCsrfToken(): string | null {
  const item = document.cookie.split('; ').find((row) => row.startsWith('medai_csrf='))
  return item ? decodeURIComponent(item.slice('medai_csrf='.length)) : null
}

export function setToken(_token: string | null): void {
  // Токен веб-сессии не сохраняем нигде: только HttpOnly-cookie.
  {
    localStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(TOKEN_KEY)
  }
}

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Content-Type ставим только для JSON-тела: браузер сам выставит
  // multipart/form-data с boundary для FormData (см. TECH_DEBT_AUDIT.md F001 —
  // раньше JSON-заголовок ломал загрузку документов: 422 «Field required»).
  const isFormData = options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  }
  const method = (options.method ?? 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = getCsrfToken()
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const resp = await fetch(path, { ...options, headers, credentials: 'same-origin' })

  if (resp.status === 204) return undefined as T
  const body = await resp.json().catch(() => ({}))

  if (!resp.ok) {
    if (resp.status === 401) {
      setToken(null)
      window.dispatchEvent(new Event('medai:unauthorized'))
    }
    // FastAPI 422 отдаёт detail массивом объектов валидации — собираем в строку
    const detail = (body as { detail?: unknown }).detail
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((d) => (d as { msg?: string }).msg).filter(Boolean).join('; ')
        : `Ошибка ${resp.status}`
    throw new ApiError(resp.status, message)
  }
  return body as T
}

// ---------- auth ----------

export async function register(
  email: string, password: string,
  firstName: string, lastName: string, middleName: string,
  inviteCode?: string, branchId?: number, phone?: string,
) {
  const data = await request<{ user: User }>('/api/auth/register', {
    method: 'POST',
    headers: { 'X-Client-Type': 'web' },
    body: JSON.stringify({
      email,
      password,
      first_name: firstName,
      last_name: lastName,
      middle_name: middleName,
      ...(phone ? { phone } : {}),
      ...(inviteCode ? { invite_code: inviteCode } : {}),
      ...(branchId ? { branch_id: branchId } : {}),
    }),
  })
  return data.user
}

export async function fetchBranches(): Promise<{ items: Branch[] }> {
  return request('/api/auth/branches')
}

export async function fetchMe(): Promise<User> {
  return request<User>('/api/auth/me')
}

export async function login(email: string, password: string) {
  const data = await request<{ user: User }>('/api/auth/login', {
    method: 'POST',
    headers: { 'X-Client-Type': 'web' },
    body: JSON.stringify({ email, password }),
  })
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

export async function changeBranch(branchId: number, currentPassword: string): Promise<User> {
  return request('/api/auth/me/branch', {
    method: 'POST',
    body: JSON.stringify({ branch_id: branchId, current_password: currentPassword }),
  })
}

// ---------- безопасность (Г1, Г2) ----------

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request<void>('/api/auth/me/password', {
    method: 'PUT',
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
}

export async function changeEmail(currentPassword: string, email: string): Promise<User> {
  return request<User>('/api/auth/me/email', {
    method: 'PUT',
    body: JSON.stringify({ current_password: currentPassword, email }),
  })
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

// ---------- заметки врача пациенту ----------

export async function fetchMyNotes(): Promise<{ items: DoctorNoteItem[] }> {
  return request('/api/notes/mine')
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

/** Мультизагрузка: несколько файлов за один запрос; ответ — список в порядке запроса. */
export async function uploadDocuments(files: File[], title: string): Promise<DocumentItem[]> {
  const fd = new FormData()
  for (const file of files) fd.append('file', file)
  // Название имеет смысл для одного файла: при пачке каждый назовётся из бланка
  fd.append('title', files.length === 1 ? title : '')
  return request('/api/documents', { method: 'POST', body: fd })
}

export async function fetchDocuments(): Promise<{ items: DocumentItem[] }> {
  return request('/api/documents')
}

export async function deleteDocument(id: number): Promise<void> {
  return request<void>(`/api/documents/${id}`, { method: 'DELETE' })
}

/** Правка названия и/или категории: ручное название переживает пере-OCR. */
export async function editDocument(
  id: number,
  patch: { title?: string; category?: string },
): Promise<DocumentItem> {
  return request(`/api/documents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export async function startDocumentOcr(id: number): Promise<OcrResult> {
  return request(`/api/documents/${id}/ocr`, { method: 'POST' })
}

export async function fetchDocumentOcr(id: number): Promise<OcrResult> {
  return request(`/api/documents/${id}/ocr`)
}

// ---------- структурированные показатели (Д3, Д4) ----------

export async function fetchLabKeys(): Promise<{ items: Array<{ key: string; label: string }> }> {
  return request('/api/documents/lab-keys')
}

export async function fetchLabTrend(key: string): Promise<{ key: string; label: string; items: LabTrendPoint[] }> {
  return request(`/api/documents/lab-trend?key=${encodeURIComponent(key)}`)
}

// ---------- документы пациента у врача (В1—В4) ----------

export async function fetchPatientDocuments(patientId: number | string): Promise<{ items: DocumentItem[] }> {
  return request(`/api/doctor/patients/${patientId}/documents`)
}

export async function fetchPatientDocumentOcr(
  patientId: number | string, docId: number,
): Promise<OcrResult> {
  return request(`/api/doctor/patients/${patientId}/documents/${docId}/ocr`)
}

// ---------- дневник самочувствия (Е2) ----------

export async function fetchSymptomNotes(): Promise<{ items: SymptomNote[] }> {
  return request('/api/symptoms/mine')
}

export async function addSymptomNote(input: {
  recorded_at?: string
  wellbeing: number
  text: string
}): Promise<SymptomNote> {
  return request('/api/symptoms', { method: 'POST', body: JSON.stringify(input) })
}

export async function deleteSymptomNote(id: number): Promise<void> {
  return request<void>(`/api/symptoms/${id}`, { method: 'DELETE' })
}

export async function fetchPatientSymptoms(
  patientId: number | string,
): Promise<{ items: SymptomNote[] }> {
  return request(`/api/doctor/patients/${patientId}/symptoms`)
}

// ---------- направления врача (Е3) ----------

export async function fetchMyOrders(): Promise<{ items: DoctorOrder[] }> {
  return request('/api/orders/mine')
}

export async function completeOrder(id: number): Promise<DoctorOrder> {
  return request(`/api/orders/${id}/complete`, { method: 'POST' })
}

export async function fetchPatientOrders(
  patientId: number | string,
): Promise<{ items: DoctorOrder[] }> {
  return request(`/api/doctor/patients/${patientId}/orders`)
}

export async function createPatientOrder(
  patientId: number | string,
  input: { title: string; category?: string },
): Promise<DoctorOrder> {
  return request(`/api/doctor/patients/${patientId}/orders`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function cancelPatientOrder(orderId: number): Promise<DoctorOrder> {
  return request(`/api/doctor/orders/${orderId}/cancel`, { method: 'POST' })
}

// ---------- уведомления (колокольчик, Б1) ----------

export async function fetchNotifications(): Promise<{ unread: number; items: NotificationItem[] }> {
  return request('/api/notifications')
}

/** Список уведомлений просмотрен: пациенту сбрасывает счётчик. */
export async function markNotificationsSeen(): Promise<void> {
  return request<void>('/api/notifications/seen', { method: 'POST' })
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
