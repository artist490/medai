// Дружелюбная иллюстрация для пустых состояний (в духе Сбер Здоровья):
// карточка-планшет с тил-градиентом, спарклы и мягкая тень. Чистый SVG,
// перекрашивается вместе с темой.
export default function EmptyArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 180 132" width="180" height="132" aria-hidden focusable="false" className={className}>
      <defs>
        <linearGradient id="emptyart-teal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00b8a9" />
          <stop offset="1" stopColor="#007b83" />
        </linearGradient>
      </defs>
      {/* мягкая тень-подложка */}
      <ellipse cx="92" cy="118" rx="64" ry="9" fill="#0b3d3a" opacity="0.07" />
      {/* дальняя карточка */}
      <rect x="44" y="30" width="86" height="70" rx="12" fill="url(#emptyart-teal)" opacity="0.13" />
      {/* ближняя карточка */}
      <rect x="56" y="24" width="92" height="76" rx="13" fill="#ffffff" stroke="#e6eeec" />
      <rect x="56" y="24" width="92" height="76" rx="13" fill="url(#emptyart-teal)" opacity="0.07" />
      {/* строки «записей» */}
      <rect x="68" y="38" width="50" height="8" rx="4" fill="url(#emptyart-teal)" opacity="0.45" />
      <rect x="68" y="53" width="66" height="7" rx="3.5" fill="#dcebe8" />
      <rect x="68" y="66" width="42" height="7" rx="3.5" fill="#e6efed" />
      {/* пульс-чип */}
      <rect x="68" y="82" width="34" height="12" rx="6" fill="url(#emptyart-teal)" opacity="0.16" />
      <path d="M72 88h5l2.4-4 3.2 8 2.2-4h5.2" fill="none" stroke="#007b83" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      {/* спарклы */}
      <path d="M156 22l2.6 7.4 7.4 2.6-7.4 2.6-2.6 7.4-2.6-7.4-7.4-2.6 7.4-2.6z" fill="url(#emptyart-teal)" opacity="0.85" />
      <path d="M36 14l1.7 4.7 4.7 1.7-4.7 1.7-1.7 4.7-1.7-4.7-4.7-1.7 4.7-1.7z" fill="#facc15" opacity="0.9" />
      <circle cx="160" cy="62" r="3" fill="#00b8a9" opacity="0.4" />
    </svg>
  )
}
