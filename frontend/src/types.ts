// Типы данных API MedAI

export type RiskLevel = 'green' | 'yellow' | 'red'
export type Status = 'ok' | 'warn' | 'alarm'

export type Role = 'patient' | 'doctor'

export interface Branch {
  id: number
  city: string
  phone: string
}

export interface User {
  id: number
  email: string
  name: string
  age: number | null
  sex: 'male' | 'female' | null
  height_cm: number | null
  role: Role
  branch: Branch | null
}

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface Finding {
  key: string
  label: string
  value: string
  unit: string
  status: Status
  message: string
  norm: string
}

export interface DoctorNote {
  id: number
  doctor_name: string
  text: string
  created_at: string
}

export interface Analysis {
  id: number
  measurement_id: number
  created_at: string
  risk_level: RiskLevel
  source: string
  findings: Finding[]
  recommendations: string[]
  llm_summary: string | null
  llm_items: string[] | null
  bmi: number | null
  doctor_seen_at?: string | null
  notes?: DoctorNote[]
}

export interface Measurement {
  id: number
  recorded_at: string
  period: 'morning' | 'evening' | null
  systolic: number | null
  diastolic: number | null
  pulse: number | null
  temperature: number | null
  spo2: number | null
  sleep_hours: number | null
  steps: number | null
  water_ml: number | null
  weight_kg: number | null
  analysis?: Analysis
}

export interface Goals {
  steps: number | null
  sleep: number | null
  water: number | null
  weight: number | null
}

export interface DocumentItem {
  id: number
  title: string
  filename: string
  mime: string
  size: number
  uploaded_at: string
}

export interface DoctorSignal {
  analysis_id: number
  patient_id: number
  patient_name: string
  recorded_at: string
  summary: string
}

export interface BranchAnalytics {
  branch_city: string | null
  patients_total: number
  requires_attention: number
  risk_split: { green: number; yellow: number; red: number }
  stale_patients: number
  measurements_14d: Array<{ day: string; count: number }>
  patients: Array<{ id: number; name: string; last_at: string | null; last_risk: RiskLevel | null }>
}

export interface Stats {
  points: Array<{ recorded_at: string } & Partial<Record<string, number>>>
  bmi_points: Array<{ recorded_at: string; bmi: number }>
}

// Пациент в списке врача
export interface PatientRow {
  id: number
  email: string
  name: string
  age: number | null
  sex: 'male' | 'female' | null
  height_cm: number | null
  created_at: string
  last_measurement_at: string | null
  last_risk: RiskLevel | null
  survey_alarms: number          // тревожные ответы опросника МЗ
  planned_visits: number         // плановые приёмы
  requires_attention: boolean
  counts: { green: number; yellow: number; red: number }
  total: number
  unread_signals: number
}

// Медкарта: анкета-анамнез пациента (заполняют пациент и врач)
export interface MedCard {
  blood_type: string
  allergies: string
  chronic: string
  medications: string
  surgeries: string
  smoking: string
  alcohol: string
  activity: string
  survey: string | null   // JSON ответов опросника Минздрава (404н)
  updated_by: 'patient' | 'doctor' | null
  updated_at: string | null
  alarm_keys?: string[]   // тревожные ключи опросника из API (signals.ALARM_SURVEY_KEYS); нет поля — фронт берёт fallback
}

export interface MedCardInput {
  blood_type?: string
  allergies?: string
  chronic?: string
  medications?: string
  surgeries?: string
  smoking?: string
  alcohol?: string
  activity?: string
  survey?: string | null
}

export type VisitStatus = 'planned' | 'completed' | 'cancelled'

// Приём: пациент описывает жалобы, врач пишет заключение
export interface Visit {
  id: number
  patient_id: number
  doctor_id: number | null
  doctor_name?: string | null
  branch_id: number | null
  visit_date: string
  reason: string
  complaints: string
  status: VisitStatus
  conclusion: string
  recommendations: string
  created_at: string
  updated_at: string | null
}
