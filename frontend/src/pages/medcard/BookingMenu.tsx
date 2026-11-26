// Выбор способа записи к реальному врачу: сайт клиники, звонок или приложение
// (разделено из MedCard.tsx, F008)
import { useAuth } from '../../auth'
import { brand, clinicCityUrl } from '../../brand'
import { Icon } from '../../components/Icon'
import type { IconName } from '../../components/Icon'

function Option({ href, onClick, icon, title, note }: {
  href?: string
  onClick?: () => void
  icon: IconName
  title: string
  note: string
}) {
  const inner = (
    <>
      <Icon name={icon} size={17} className="text-teal-dark shrink-0 mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{title}</span>
        <span className="block text-[11.5px] text-ink-soft mt-0.5 leading-relaxed">{note}</span>
      </span>
      <Icon name="chevron" size={13} className="ml-auto text-ink-soft shrink-0" />
    </>
  )
  const cls = 'flex items-start gap-3 border border-line rounded-md px-3.5 py-3 hover:border-[#c4ccc8] transition-quick w-full text-left'
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>
    : <button onClick={onClick} className={cls}>{inner}</button>
}

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
    <div className="panel flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-medium text-ink">Записаться: {reason}</div>
          <div className="text-[11.5px] text-ink-soft mt-1">
            Запись ведёт к врачу «Спектр-Диагностики».
          </div>
        </div>
        <button className="topbar-icon" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={15} />
        </button>
      </div>

      <Option
        href={clinicCityUrl(branch?.city)}
        icon="care"
        title="Онлайн-запись на сайте клиники"
        note={`${branch ? `${branch.city} · ` : ''}откроется spdmed.ru — выберите врача и время`}
      />
      <Option
        href={telHref}
        icon="help"
        title="Позвонить филиалу"
        note={phone}
      />
      <Option
        onClick={onAppBooking}
        icon="calendar"
        title="Оставить жалобу в приложении"
        note="Врач вашего филиала увидит её до приёма"
      />
    </div>
  )
}
