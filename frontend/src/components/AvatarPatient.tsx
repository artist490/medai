// Аватар пациента: дружелюбная flat-иллюстрация радостного человека.
// Собственный фон-кружок с тил-градиентом — самодостаточный аватар,
// масштабируется без потерь. Тень-подложку даёт класс-обёртка .avatar-ill.
export default function AvatarPatient({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span className={`avatar-ill ${className ?? ''}`} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 96 96" width={size} height={size} focusable="false">
        <defs>
          <linearGradient id="ill-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00c7b6" />
            <stop offset="1" stopColor="#00737c" />
          </linearGradient>
        </defs>
        <circle cx="48" cy="48" r="48" fill="url(#ill-bg)" />
        {/* футболка */}
        <path d="M14 96c1.2-17 13.4-24.5 34-24.5S80.8 79 82 96z" fill="#f5a04c" />
        {/* шея */}
        <rect x="41.5" y="56" width="13" height="14" rx="5" fill="#f2b98e" />
        {/* уши */}
        <circle cx="31.5" cy="44" r="3.6" fill="#ffd9b8" />
        <circle cx="64.5" cy="44" r="3.6" fill="#ffd9b8" />
        {/* голова */}
        <ellipse cx="48" cy="41" rx="17" ry="18" fill="#ffd9b8" />
        {/* причёска */}
        <path
          d="M29.5 45C29.5 27.5 38 20.5 48 20.5S66.5 27.5 66.5 45c-3.8-5.2-8.6-7.4-12.8-6.9-2.4.3-8.6-.8-13.4-2.6-4.6-1.7-8.6 2-10.8 9.5z"
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
      </svg>
    </span>
  )
}
