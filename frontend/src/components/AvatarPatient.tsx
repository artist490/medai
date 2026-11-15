// Обычный аватар пациента: силуэт человека (голова + плечи) без халата.
// Фигура красится через currentColor: на тил-градиенте — белая (text-white),
// на тинтовых кружках риска — цвет статуса (row-avatar задаёт color).
export default function AvatarPatient({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      focusable="false"
      className={`inline-block select-none shrink-0 ${className ?? ''}`}
    >
      {/* голова */}
      <circle cx="16" cy="10.2" r="5.4" fill="currentColor" />
      {/* плечи */}
      <path d="M5.6 32c.8-7.6 4.8-11.4 10.4-11.4S25.6 24.4 26.4 32z" fill="currentColor" />
    </svg>
  )
}
