// Риск-профиль по системам организма: сворачивает свежие замеры в картину
// «одним взглядом». Идея подсмотрена у Сбер Здоровье, стиль — «Клинический свет».
// Анамнез из опросника Минздрава (survey) подсвечивает системы даже без замеров:
// диагнозы дают «Внимание», тревожные симптомы — «Тревога».
import { Icon } from './Icon'
import { SURVEY_SHORT, ALARM_KEYS } from './AnamnesisSurvey'
import type { Measurement, Status } from '../types'
import type { Finding } from '../types'

interface SystemDef {
  key: string
  label: string
  keys: string[]
  surveyKeys?: string[]   // пункты опросника, относящиеся к системе
}

const SYSTEMS: SystemDef[] = [
  { key: 'cardio', label: 'Сердце и сосуды', keys: ['blood_pressure', 'pulse'],
    surveyKeys: ['dx_hypertension', 'dx_chd', 'dx_cvd', 'dx_cholesterol', 'hx_mi_self', 'hx_stroke_self', 'hx_mi_stroke_family', 'sym_chest_pain', 'sym_sudden_weakness', 'sym_sudden_numbness', 'sym_vision_loss'] },
  { key: 'breath', label: 'Дыхание', keys: ['spo2'],
    surveyKeys: ['dx_lung', 'dx_tb', 'sym_chronic_cough', 'sym_wheezing', 'sym_hemoptysis'] },
  { key: 'digestion', label: 'Пищеварение', keys: [],
    surveyKeys: ['dx_stomach', 'sym_epigastric', 'sym_black_stool', 'sym_rectal_pain', 'sym_blood_in_stool', 'sym_weight_loss'] },
  { key: 'general', label: 'Общее состояние', keys: ['temperature'] },
  { key: 'sleep', label: 'Сон и восстановление', keys: ['sleep'] },
  { key: 'weight', label: 'Вес и обмен веществ', keys: ['bmi'],
    surveyKeys: ['dx_diabetes'] },
  { key: 'lifestyle', label: 'Образ жизни', keys: ['steps', 'water'],
    surveyKeys: ['smoking_now', 'salting', 'walking_30min'] },
]

const STATUS_META: Record<Status, { label: string; color: string; badge: string }> = {
  ok: { label: 'Норма', color: '#00b8a9', badge: 'badge-green' },
  warn: { label: 'Внимание', color: '#c99700', badge: 'badge-gold' },
  alarm: { label: 'Тревога', color: '#dc2626', badge: 'badge-red' },
}

const SEVERITY: Record<Status, number> = { alarm: 3, warn: 2, ok: 1 }

interface SystemRisk {
  def: SystemDef
  status: Status | null            // null = данных нет
  findings: Finding[]              // свежие значения показателей системы
  surveyFlags: string[]            // короткие лейблы анамнеза
}

function surveyFlagsOf(survey: string | null | undefined, def: SystemDef): string[] {
  if (!survey || !def.surveyKeys) return []
  let data: Record<string, unknown>
  try {
    data = JSON.parse(survey) as Record<string, unknown>
  } catch {
    return []
  }
  return def.surveyKeys
    .filter((k) => data[k] === true)
    .map((k) => (k === 'walking_30min' ? 'ходьба <30 мин/день' : SURVEY_SHORT[k] ?? k))
}

function computeRisks(items: Measurement[], survey: string | null | undefined, alarmKeys: Set<string>): SystemRisk[] {
  // Самое свежее значение каждого показателя: API отдаёт замеры новыми сверху
  const latest = new Map<string, Finding>()
  for (const m of items) {
    for (const f of m.analysis?.findings ?? []) {
      if (!latest.has(f.key)) latest.set(f.key, f)
    }
  }
  return SYSTEMS.map((def) => {
    const findings = def.keys
      .map((k) => latest.get(k))
      .filter((f): f is Finding => !!f)
    let status = findings.reduce<Status | null>((worst, f) => {
      if (worst === null || SEVERITY[f.status] > SEVERITY[worst]) return f.status
      return worst
    }, null)

    // Анамнез: тревожный симптом → «Тревога», диагноз/фактор → минимум «Внимание»
    const flags = surveyFlagsOf(survey, def)
    if (flags.length > 0) {
      const hasAlarm = def.surveyKeys?.some((k) => dataIsTrue(survey, k) && alarmKeys.has(k)) ?? false
      const floor: Status = hasAlarm ? 'alarm' : 'warn'
      if (status === null || SEVERITY[floor] > SEVERITY[status]) status = floor
    }
    return { def, status, findings, surveyFlags: flags }
  })
}

function dataIsTrue(survey: string | null | undefined, key: string): boolean {
  if (!survey) return false
  try {
    return (JSON.parse(survey) as Record<string, unknown>)[key] === true
  } catch {
    return false
  }
}

export default function RiskSystems({ items, survey, alarmKeys, onBook }: {
  items: Measurement[]
  survey?: string | null
  alarmKeys?: string[]   // из API (MedCard.alarm_keys); не пришло — fallback на ALARM_KEYS из AnamnesisSurvey
  onBook?: (reason: string) => void
}) {
  const risks = computeRisks(items, survey, alarmKeys ? new Set(alarmKeys) : ALARM_KEYS)
  const troubled = risks.filter((r) => r.status === 'alarm' || r.status === 'warn')
  const worst = troubled.find((r) => r.status === 'alarm') ?? troubled[0] ?? null
  const hasData = risks.some((r) => r.status !== null)

  return (
    <div className="bg-white rounded-xl p-6 glow-soft">
      <div className="section-title mb-1">
        <span className="emoji-box"><Icon name="pulse" size={20} /></span>
        Риск по системам организма
      </div>
      <div className="text-xs font-bold text-ink-soft mb-4">
        {hasData ? 'по последним замерам и анкете' : 'появится после замеров или опросника'}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {risks.map((r) => {
          const meta = r.status ? STATUS_META[r.status] : null
          return (
            <div key={r.def.key} className={`border border-[#e9efed] rounded-xl p-3.5 ${meta ? '' : 'opacity-55'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold text-teal-dark">{r.def.label}</span>
                {meta ? (
                  // точку рисует сам .badge (::before) — дублировать не нужно
                  <span className={`badge ${meta.badge} normal-case tracking-normal`}>
                    {meta.label}
                  </span>
                ) : (
                  <span className="badge normal-case tracking-normal">нет данных</span>
                )}
              </div>
              {(r.findings.length > 0 || r.surveyFlags.length > 0) && (
                <div className="mt-2.5 flex flex-col gap-1">
                  {r.findings.map((f) => (
                    <div key={f.key} className="text-xs text-[#465a56]" title={f.message}>
                      {f.label}: <span className="font-semibold text-[#1b2622]">{f.value} {f.unit}</span>
                    </div>
                  ))}
                  {r.surveyFlags.map((flag) => (
                    <div key={flag} className="text-xs text-ink-soft" title="Из опросника Минздрава">
                      из анкеты: {flag}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {onBook && worst && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-bold text-teal-deep">
            По системе «{worst.def.label}» стоит показаться врачу.
          </span>
          <button className="btn btn-gold btn-sm" onClick={() => onBook(`Консультация: ${worst.def.label.toLowerCase()}`)}>
            Записаться к врачу
          </button>
        </div>
      )}
    </div>
  )
}
