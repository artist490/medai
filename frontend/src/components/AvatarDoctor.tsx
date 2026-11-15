// Аватар врача: фигура в белом халате со стетоскопом на тил-градиенте.
// Пациенты остаются с обычными инициалами (row-avatar / avatar-circle).
export default function AvatarDoctor({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      className={`doctor-avatar ${className ?? ''}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" width={Math.round(size * 0.82)} height={Math.round(size * 0.82)} focusable="false">
        {/* голова */}
        <circle cx="16" cy="9.8" r="5" fill="#ffffff" />
        {/* халат с плечами */}
        <path d="M6 32c.7-7 4.5-12 10-12s9.3 5 10 12z" fill="#ffffff" />
        {/* V-вырез халата + стетоскоп */}
        <path d="M12.6 21.6 16 26.6l3.4-5" fill="none" stroke="#007b83" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 26.6v2.4" fill="none" stroke="#007b83" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="16" cy="30.4" r="1.5" fill="none" stroke="#007b83" strokeWidth="1.5" />
      </svg>
    </span>
  )
}
