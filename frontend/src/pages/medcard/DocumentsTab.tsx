// Документы: загрузка, список, скачивание (F008).
// Загрузка работает через общий request() — после фикса F001 (multipart без
// JSON-заголовка) документы реально доходят до сервера.
import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'
import { getToken, uploadDocument } from '../../api'
import { Icon } from '../../components/Icon'
import EmptyArt from '../../components/EmptyArt'
import { Skeleton } from '../../components/Skeleton'
import type { DocumentItem } from '../../types'

export default function DocumentsTab() {
  const [docs, setDocs] = useState<DocumentItem[] | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    api.fetchDocuments().then((d) => setDocs(d.items)).catch(() => setDocs([]))
  }, [])

  async function upload() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const doc = await uploadDocument(file, title)
      setDocs((prev) => prev ? [doc, ...prev] : [doc])
      setTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить')
    } finally {
      setBusy(false)
    }
  }

  async function download(doc: DocumentItem) {
    const resp = await fetch('/api/documents/' + doc.id + '/download', {
      headers: { Authorization: 'Bearer ' + getToken() },
    })
    if (!resp.ok) return
    const blob = await resp.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = doc.filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function remove(doc: DocumentItem) {
    if (!window.confirm('Удалить «' + doc.title + '»?')) return
    await api.deleteDocument(doc.id).catch(() => {})
    setDocs((prev) => prev ? prev.filter((d) => d.id !== doc.id) : prev)
  }

  function fmtSize(n: number): string {
    if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' МБ'
    return Math.max(1, Math.round(n / 1024)) + ' КБ'
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={(e) => { e.preventDefault(); upload() }}
            className="bg-white rounded-xl p-5 border border-[#e4ebe9] flex flex-col gap-3">
        <div className="text-sm font-bold text-[#1b2622]">Загрузить результат исследования</div>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="flip-input !py-2"
          ref={(el) => { fileRef.current = el }}
        />
        <input
          type="text"
          className="flip-input"
          placeholder="Название: МРТ головы, анализы крови…"
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {error && <div className="badge badge-red normal-case tracking-normal w-fit">{error}</div>}
        <button className="btn btn-teal w-fit" disabled={busy}>
          {busy ? 'Загружаем…' : 'Загрузить документ'}
        </button>
        <div className="flip-hint">PDF или фото до 8 МБ. Документы видны только вам.</div>
      </form>

      {docs === null ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="py-1 flex items-center gap-3">
              <Skeleton w={34} h={34} r={10} />
              <div className="flex flex-col gap-1.5 flex-1">
                <Skeleton w={`${55 - i * 10}%`} h={13} />
                <Skeleton w={`${30 - i * 5}%`} h={10} />
              </div>
              <Skeleton w={80} h={26} r={10} />
            </div>
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="grid place-items-center py-8 text-center">
          <EmptyArt className="mx-auto mb-2" />
          <p className="text-base font-bold text-[#1b2622]">Документов пока нет</p>
          <p className="text-sm text-teal-dark/70 max-w-sm mt-1">
            Загрузите первый результат исследования — он будет виден только вам
            и всегда под рукой в медкарте.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#eef4f3]">
          {docs.map((d) => (
            <div key={d.id} className="py-3 flex items-center gap-3">
              <span className="emoji-box"><Icon name="doc" size={18} /></span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#1b2622] truncate">{d.title}</div>
                <div className="text-xs text-[#8aa09c]">
                  {fmtSize(d.size)} · {d.uploaded_at.slice(0, 16).replace('T', ' ')}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm ml-auto" onClick={() => download(d)} aria-label={'Скачать ' + d.title}>
                <Icon name="download" size={16} />
              </button>
              <button className="btn btn-ghost btn-sm text-coral" onClick={() => remove(d)} aria-label={'Удалить ' + d.title}>
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
