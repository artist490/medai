// Типы данных API MedAI

export type RiskLevel = 'green' | 'yellow' | 'red'
export type Status = 'ok' | 'warn' | 'alarm'

export interface User {
  id: number
  email: string
  name: string
  age: number | null
  sex: 'male' | 'female' | null
  height_cm: number | null
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
