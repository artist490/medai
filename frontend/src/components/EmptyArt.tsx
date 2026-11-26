// Иллюстрация пустого состояния: разлинованная страница дневника.
// Плоская, в два цвета — без градиентов, звёздочек и «мягких теней».
export default function EmptyArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      width="160"
      height="120"
      aria-hidden
      focusable="false"
      className={className}
    >
      <rect x="26" y="14" width="108" height="92" rx="4" fill="#ffffff" stroke="#d9dedb" />
      <rect x="26" y="14" width="108" height="20" rx="4" fill="#f2f5f3" />
      <rect x="26" y="30" width="108" height="4" fill="#f2f5f3" />

      <rect x="38" y="44" width="34" height="3" rx="1.5" fill="#c9d1cd" />
      <rect x="38" y="54" width="84" height="2" rx="1" fill="#e3e6e3" />
      <rect x="38" y="62" width="72" height="2" rx="1" fill="#e3e6e3" />

      {/* пульс-линия */}
      <path
        d="M38 82h14l5-9 7 18 6-13 4 4h48"
        fill="none"
        stroke="#0b5c58"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="122" cy="82" r="2.5" fill="#0b5c58" />
    </svg>
  )
}
