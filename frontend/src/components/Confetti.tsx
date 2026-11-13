import { useEffect, useState } from 'react'

// Конфетти при полностью зелёном результате (Flip7 celebrations).
const colors = ['#2BA8A2', '#FFD23F', '#EF6C4A', '#5DADE2', '#27AE60', '#FFE47A']

export default function Confetti({ fire }: { fire: boolean }) {
  const [pieces, setPieces] = useState<Array<{ id: number; left: number; delay: number; color: string; size: number }>>([])

  useEffect(() => {
    if (!fire) return
    const next = Array.from({ length: 24 }, (_, id) => ({
      id,
      left: Math.random() * 100,
      delay: Math.random() * 1.2,
      color: colors[id % colors.length],
      size: 8 + Math.random() * 8,
    }))
    setPieces(next)
    const timer = setTimeout(() => setPieces([]), 5200)
    return () => clearTimeout(timer)
  }, [fire])

  if (!pieces.length) return null
  return (
    <>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.4,
            background: p.color,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </>
  )
}
