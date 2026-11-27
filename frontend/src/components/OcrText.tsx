// Отрисовка распознанного текста документа.
// Сервер отдаёт уже очищенный текст: таблицы выровнены пробелами, markdown-мусор
// убран. Здесь блоки таблиц превращаются в настоящую таблицу, остальное — в абзацы.
// Сырой ответ OCR доступен по кнопке «Исходный текст» — на случай сверки с бланком.
import { useMemo, useState } from 'react'

type Block =
  | { kind: 'table'; rows: string[][] }
  | { kind: 'text'; lines: string[] }

const GAP = /\s{2,}/

export function parseOcrBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let buffer: string[] = []

  const flush = () => {
    if (!buffer.length) return
    const rows = buffer.map((line) => line.trim().split(GAP))
    // Таблица — только если у всех строк одинаковое число колонок (≥2):
    // иначе двойной пробел после точки в обычном абзаце выдал бы «таблицу».
    const isTable = rows.length >= 2 && rows[0].length >= 2 && rows.every((row) => row.length === rows[0].length)
    blocks.push(isTable ? { kind: 'table', rows } : { kind: 'text', lines: buffer })
    buffer = []
  }

  for (const line of text.split('\n')) {
    if (line.trim()) buffer.push(line)
    else flush()
  }
  flush()
  return blocks
}

export default function OcrText({ text, raw }: { text: string; raw?: string | null }) {
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)
  const blocks = useMemo(() => parseOcrBlocks(text), [text])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
          {copied ? 'Скопировано' : 'Копировать текст'}
        </button>
        {raw && raw !== text && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Обработанный текст' : 'Исходный текст'}
          </button>
        )}
      </div>

      {showRaw && raw ? (
        <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[#f6faf8] p-4 text-xs leading-5 text-ink-soft">
          {raw}
        </pre>
      ) : (
        <div className="mt-2 max-h-[480px] overflow-auto rounded-lg border border-[#eef4f3] bg-[#f6faf8] p-4">
          {blocks.length === 0 ? (
            <p className="text-sm text-ink-soft">Текст не распознан.</p>
          ) : (
            blocks.map((block, index) =>
              block.kind === 'table' ? (
                <div key={index} className="overflow-x-auto py-2 first:pt-0 last:pb-0">
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={rowIndex} className={rowIndex === 0 ? 'border-b border-[#dbe7e3]' : ''}>
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              className={
                                'py-1.5 pr-4 align-top ' +
                                (rowIndex === 0 ? 'font-bold text-[#1b2622]' : 'text-[#1b2622]')
                              }
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p
                  key={index}
                  className="whitespace-pre-wrap break-words py-2 text-sm leading-6 text-[#1b2622] first:pt-0 last:pb-0"
                >
                  {block.lines.join('\n')}
                </p>
              ),
            )
          )}
        </div>
      )}
    </div>
  )
}
