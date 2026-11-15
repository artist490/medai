// Выбор способа записи к реальному врачу: сайт клиники, звонок или приложение
// (разделено из MedCard.tsx, F008)
import { useAuth } from '../../auth'
import { brand, clinicCityUrl } from '../../brand'
import { Icon } from '../../components/Icon'

export default function BookingMenu({ reason, onAppBooking, onClose }: {
  reason: string
  onAppBooking: () => void
  onClose: () => void
}) {
  const { user } = useAuth()
  const branch = user?.branch ?? null
  const phone = branch?.phone || brand.phone
  const telHref = `tel:${phone.replace(/[^+\d]/g, '')}`

  return (
    <div className="bg-white rounded-xl p-5 border-2 border-teal glow-soft flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-teal-dark">Записаться: {reason}</div>
          <div className="text-xs font-bold text-teal-dark/55 mt-0.5">
            Выберите удобный способ — запись ведёт к врачу «Спектр-Диагностики»
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Закрыть"><Icon name="close" size={15} /></button>
      </div>

      <a href={clinicCityUrl(branch?.city)} target="_blank" rel="noopener noreferrer"
         className="flip-card flip-card--ok flex items-center gap-3 hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="care" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Онлайн-запись на сайте клиники</span>
          <span className="block text-xs font-bold text-teal-dark/55">
            {branch ? `${branch.city} · ` : ''}откроется spdmed.ru — выберите врача и время
          </span>
        </span>
        <Icon name="chevron" size={14} className="ml-auto text-teal-dark/40" />
      </a>

      <a href={telHref} className="flip-card flip-card--sky flex items-center gap-3 hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="help" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Позвонить филиалу</span>
          <span className="block text-xs font-bold text-teal-dark/55">{phone}</span>
        </span>
        <Icon name="chevron" size={14} className="ml-auto text-teal-dark/40" />
      </a>

      <button onClick={onAppBooking}
              className="flip-card flex items-center gap-3 text-left hover:opacity-90 transition-quick">
        <span className="emoji-box"><Icon name="calendar" size={20} /></span>
        <span className="min-w-0">
          <span className="block text-sm font-extrabold text-teal-dark">Оставить жалобу в приложении</span>
          <span className="block text-xs font-bold text-teal-dark/55">врач вашего филиала увидит её до приёма</span>
        </span>
        <Icon name="chevron" size={14} className="ml-auto text-teal-dark/40" />
      </button>
    </div>
  )
}
