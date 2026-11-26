// Правая колонка страниц входа и регистрации: спокойная справка о том,
// что даёт кабинет. Без иллюстраций и градиентов — текст и линии.
import { Icon } from './Icon'
import { brand } from '../brand'

const POINTS = [
  'Дневник давления, пульса, сна и активности в одном месте',
  'Разбор показателей по медицинским нормам — с пометкой, где нужен врач',
  'Медкарта, приёмы и комментарии врача клиники',
] as const

export default function AuthAside() {
  return (
    <aside className="auth-aside">
      <div>
        <p className="text-[11px] uppercase tracking-[0.08em] text-ink-soft font-medium">
          Личный кабинет
        </p>
        <h2 className="auth-aside-title mt-3">
          Показатели, которые видно в динамике
        </h2>
        <ul className="auth-aside-list mt-8">
          {POINTS.map((text) => (
            <li key={text} className="auth-aside-item">
              <Icon name="check" size={16} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="auth-aside-foot">
        <p>
          {brand.name} — федеральная сеть медицинских центров.
          <br />
          {brand.phone} · {brand.site}
        </p>
        <p className="mt-4">
          Сервис ведёт дневник и помогает подготовиться к приёму. Диагноз
          ставит врач.
        </p>
      </div>
    </aside>
  )
}
