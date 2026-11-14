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
  notes?: DoctorNote[]
}

export interface Measurement {
  id: number
  recorded_at: string
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
  requires_attention: boolean
  counts: { green: number; yellow: number; red: number }
  total: number
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
