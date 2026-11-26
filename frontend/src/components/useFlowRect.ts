import { CSSProperties, RefObject, useCallback, useEffect, useLayoutEffect, useState } from 'react'

export type FlowRect = { x: number; y: number; w: number; h: number }

// Измеряет активный элемент внутри контейнера, чтобы «перетекающий»
// индикатор знал, куда съехать. Переизмеряется при смене dep, resize
// и после загрузки шрифтов (ширины кнопок могут измениться).
export function useFlowRect(ref: RefObject<HTMLElement | null>, selector: string, dep: unknown): FlowRect | null {
  const [rect, setRect] = useState<FlowRect | null>(null)

  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>(selector)
    if (!el) {
      setRect(null)
      return
    }
    setRect({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
  }, [ref, selector])

  useLayoutEffect(measure, [measure, dep])
  useEffect(() => {
    const ro = new ResizeObserver(() => measure())
    if (ref.current) ro.observe(ref.current)
    document.fonts?.ready.then(() => measure()).catch(() => {})
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, ref])

  return rect
}

// Стиль перетекающего индикатора: анимируется ТОЛЬКО transform.
// Ширина/высота — «закоммиченная» база; новый размер доезжает через
// scale и фиксируется после завершения перехода — layout в кадре
// не пересчитывается, движение остаётся плавным.
export function useFlowIndicatorStyle(rect: FlowRect | null): CSSProperties {
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)

  // Первый замер — сразу как база, без анимации
  useEffect(() => {
    if (!rect) {
      setBase(null)
      return
    }
    setBase((prev) => prev ?? { w: rect.w, h: rect.h })
  }, [rect])

  // После перехода фиксируем новый размер без анимации
  useEffect(() => {
    if (!rect || !base || (rect.w === base.w && rect.h === base.h)) return
    const t = window.setTimeout(() => setBase({ w: rect.w, h: rect.h }), 450)
    return () => window.clearTimeout(t)
  }, [rect, base])

  if (!rect || !base) return { opacity: 0 }
  return {
    width: base.w,
    height: base.h,
    transform: `translate(${rect.x}px, ${rect.y}px) scale(${rect.w / base.w}, ${rect.h / base.h})`,
    transformOrigin: 'top left',
    opacity: 1,
  }
}
