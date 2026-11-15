// Аватар врача: дружелюбная flat-иллюстрация доктора в белом халате
// со стетоскопом. Тот же стиль, что у аватара пациента (AvatarPatient).
export default function AvatarDoctor({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span className={`avatar-ill ${className ?? ''}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 96 96" width={size} height={size} focusable="false">
        <defs>
          <linearGradient id="ill-bgd" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00c7b6" />
            <stop offset="1" stopColor="#00737c" />
          </linearGradient>
        </defs>
        <circle cx="48" cy="48" r="48" fill="url(#ill-bgd)" />
        {/* белый халат */}
        <path d="M14 96c1.2-17 13.4-24.5 34-24.5S80.8 79 82 96z" fill="#ffffff" />
        {/* вырез халата: рубашка + лацканы */}
        <path d="M39.5 72.8 48 91.5 56.5 72.8c-5.3-1.1-11.7-1.1-17 0z" fill="url(#ill-bgd)" />
        {/* шея */}
        <rect x="41.5" y="56" width="13" height="14" rx="5" fill="#f2b98e" />
        {/* уши */}
        <circle cx="31.5" cy="44" r="3.6" fill="#ffd9b8" />
        <circle cx="64.5" cy="44" r="3.6" fill="#ffd9b8" />
        {/* голова */}
        <ellipse cx="48" cy="41" rx="17" ry="18" fill="#ffd9b8" />
        {/* причёска покороче */}
        <path
          d="M31 44.5C31 28 38.5 21.5 48 21.5S65 28 65 44.5c-3.2-4.8-7.6-6.6-11.6-6.1-2.6.3-7.4-.7-11-2.2-4.3-1.8-8.4.8-11.4 8.3z"
          fill="#4a3428"
        />
        {/* радостные глаза-дужки */}
        <path d="M38.6 46q3.7 3.6 7.4 0" fill="none" stroke="#3b2f2a" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M50 46q3.7 3.6 7.4 0" fill="none" stroke="#3b2f2a" strokeWidth="2.1" strokeLinecap="round" />
        {/* румянец */}
        <circle cx="35.2" cy="50.5" r="3.1" fill="#f79892" opacity="0.5" />
        <circle cx="60.8" cy="50.5" r="3.1" fill="#f79892" opacity="0.5" />
        {/* улыбка */}
        <path d="M41 52.5Q48 59.5 55 52.5" fill="none" stroke="#3b2f2a" strokeWidth="2.2" strokeLinecap="round" />
        {/* стетоскоп на халате */}
        <path
          d="M42.5 74c-1.4 6.2-.6 11.4 3 14.8M53.5 74c1.4 6.2.6 11.4-3 14.8"
          fill="none"
          stroke="#007b83"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="48" cy="90.2" r="2.8" fill="#00b8a9" stroke="#007b83" strokeWidth="1.6" />
      </svg>
    </span>
  )
}
