// Документы: загрузка, список, скачивание (F008).
// Загрузка работает через общий request() — после фикса F001 (multipart без
// JSON-заголовка) документы реально доходят до сервера.
import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../../api'
import { uploadDocuments } from '../../api'
import { Icon } from '../../components/Icon'
import EmptyArt from '../../components/EmptyArt'
import OcrText from '../../components/OcrText'
import { Skeleton } from '../../components/Skeleton'
import type { DocumentItem, OcrResult } from '../../types'

// Порядок групп = порядок справочника doc_categories.py; other последним.
const DOC_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'blood', label: 'Кровь' },
  { key: 'hormones', label: 'Гормоны и биохимия' },
  { key: 'urine', label: 'Моча' },
  { key: 'stool', label: 'Кал' },
  { key: 'smears', label: 'Мазки и цитология' },
  { key: 'imaging', label: 'МРТ, КТ, УЗИ и рентген' },
  { key: 'function', label: 'ЭКГ и функциональная диагностика' },
  { key: 'other', label: 'Прочее' },
]

function groupedDocs(docs: DocumentItem[]): Array<{ key: string; label: string; docs: DocumentItem[] }> {
  const groups = new Map<string, DocumentItem[]>()
  for (const d of docs) {
    const key = DOC_CATEGORIES.some((c) => c.key === d.category) ? d.category : 'other'
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  return DOC_CATEGORIES
    .filter((c) => groups.has(c.key))
    .map((c) => ({ key: c.key, label: c.label, docs: groups.get(c.key) ?? [] }))
}

export default function DocumentsTab() {
  const [docs, setDocs] = useState<DocumentItem[] | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [ocrDocId, setOcrDocId] = useState<number | null>(null)
  const [ocr, setOcr] = useState<OcrResult | null>(null)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: number; title: string; category: string } | null>(null)
  const [editBusy, setEditBusy] = useState(false)

  useEffect(() => {
    if (ocrDocId === null || !ocr || !['pending', 'processing'].includes(ocr.status)) return
    const timer = window.setTimeout(() => {
      api.fetchDocumentOcr(ocrDocId).then((result) => {
        setOcr(result)
        setDocs((prev) => prev?.map((d) => d.id === ocrDocId ? { ...d, ocr: result } : d) ?? prev)
        // После готовности OCR сервер мог выставить категорию и авто-название —
        // тихо обновляем список целиком (скелетон не показываем).
        if (result.status === 'ready') {
          api.fetchDocuments().then((d) => setDocs(d.items)).catch(() => {})
        }
      }).catch((e) => setError(e instanceof Error ? e.message : 'Не удалось проверить OCR'))
    }, 2000)
    return () => window.clearTimeout(timer)
  }, [ocrDocId, ocr])

  async function recognize(doc: DocumentItem) {
    setOcrDocId(doc.id)
    setOcrBusy(true)
    setError('')
    try {
      let result = doc.ocr
      if (result.status === 'ready') result = await api.fetchDocumentOcr(doc.id)
      else result = await api.startDocumentOcr(doc.id)
      setOcr(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Серверный OCR недоступен')
    } finally {
      setOcrBusy(false)
    }
  }

  function loadDocs() {
    setListError('')
    setDocs(null)
    api.fetchDocuments()
      .then((d) => setDocs(d.items))
      .catch((e) => setListError(e instanceof Error ? e.message : 'Не удалось загрузить документы'))
  }

  useEffect(() => {
    loadDocs()

  }, [])

  // Мультизагрузка (A1) и вставка из буфера: скриншот бланка → Ctrl+V → документ
  const uploadFiles = useCallback(async (files: File[], pasteTitle: string) => {
    if (files.length === 0) return
    setBusy(true)
    setError('')
    try {
      const created = await uploadDocuments(files, pasteTitle)
      setDocs((prev) => prev ? [...created, ...prev] : created)
      setTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (busy) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        ['image/png', 'image/jpeg', 'image/webp'].includes(f.type))
      if (files.length === 0) return
      e.preventDefault()
      void uploadFiles(files, '')
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [busy, uploadFiles])

  async function upload() {
    const files = Array.from(fileRef.current?.files ?? [])
    await uploadFiles(files, title)
  }

  async function download(doc: DocumentItem) {
    const resp = await fetch('/api/documents/' + doc.id + '/download', {
      credentials: 'same-origin',
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

  function startEdit(doc: DocumentItem) {
    setEditing({ id: doc.id, title: doc.title, category: doc.category || 'other' })
  }

  async function saveEdit() {
    if (!editing) return
    setEditBusy(true)
    setError('')
    try {
      const updated = await api.editDocument(editing.id, {
        title: editing.title,
        category: editing.category,
      })
      setDocs((prev) => prev ? prev.map((d) => d.id === updated.id ? updated : d) : prev)
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setEditBusy(false)
    }
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
          multiple
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
        <button className="btn btn-gold w-fit" disabled={busy}>
          {busy ? 'Загружаем…' : 'Загрузить документ'}
        </button>
        <div className="flip-hint">PDF или фото до 8 МБ, можно несколько файлов сразу.
          Скриншот бланка можно просто вставить из буфера — Ctrl+V.
          Название необязательно — подставим из распознанного текста.
          OCR выполняется локально на сервере клиники, без внешнего API.</div>
      </form>

      {ocrDocId !== null && ocr && (ocr.status !== 'disabled' || !ocr.enabled) && (
        <section className="bg-white rounded-xl p-5 border border-[#e4ebe9]" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold">Серверное распознавание</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => { setOcrDocId(null); setOcr(null) }}>Закрыть</button>
          </div>
          {!ocr.enabled ? (
            <p className="text-sm text-ink-soft mt-3">OCR не настроен на сервере. Обратитесь к администратору клиники.</p>
          ) : ['pending', 'processing'].includes(ocr.status) ? (
            <p className="text-sm text-ink-soft mt-3">
              {ocr.status === 'pending' ? 'Документ в очереди на распознавание…' : 'Обрабатываем документ на сервере…'}
            </p>
          ) : ocr.status === 'failed' ? (
            <>
              <div className="badge badge-red normal-case tracking-normal mt-3">{ocr.error ?? 'Ошибка распознавания'}</div>
              <button className="btn btn-ghost btn-sm mt-3" disabled={ocrBusy}
                      onClick={() => { const doc = docs?.find((d) => d.id === ocrDocId); if (doc) recognize(doc) }}>
                Повторить распознавание
              </button>
            </>
          ) : ocr.status === 'ready' ? (
            <>
              <p className="flip-hint mt-2">Проверьте текст: OCR может ошибаться. Ничего не добавлено в медкарту автоматически.</p>
              <OcrText text={ocr.text ?? ''} raw={ocr.text_raw} />
            </>
          ) : <p className="text-sm text-ink-soft mt-3">Нажмите «Распознать» у нужного документа.</p>}
        </section>
      )}

      {listError ? (
        <div className="flex flex-col items-start gap-3">
          <div className="badge badge-red normal-case tracking-normal w-fit">{listError}</div>
          <button className="btn btn-ghost" onClick={loadDocs}>Повторить</button>
        </div>
      ) : docs === null ? (
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
          <p className="text-sm text-ink-soft max-w-sm mt-1">
            Загрузите первый результат исследования — он будет виден только вам
            и всегда под рукой в медкарте.
          </p>
        </div>
      ) : (
        groupedDocs(docs).map((group) => (
          <section key={group.key}>
            <div className="flex items-center gap-2 mb-1 mt-2">
              <h3 className="text-sm font-extrabold text-teal-dark">{group.label}</h3>
              <span className="text-xs font-semibold text-ink-soft">· {group.docs.length}</span>
            </div>
            <div className="divide-y divide-[#eef4f3]">
              {group.docs.map((d) => (
                <div key={d.id} className="py-3 flex items-center gap-3">
                  <span className="emoji-box"><Icon name="doc" size={18} /></span>
                  {editing?.id === d.id ? (
                    <div className="min-w-0 flex-1 flex flex-col gap-2">
                      <input
                        className="flip-input !py-1.5 text-sm"
                        value={editing.title}
                        maxLength={200}
                        aria-label="Название документа"
                        onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }}
                      />
                      <div className="flex items-center gap-2">
                        <select
                          className="flip-input !py-1.5 text-sm max-w-[240px]"
                          value={editing.category}
                          aria-label="Категория документа"
                          onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                        >
                          {DOC_CATEGORIES.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                        <button className="btn btn-teal btn-sm" disabled={editBusy || !editing.title.trim()}
                                onClick={saveEdit}>
                          {editBusy ? 'Сохраняем…' : 'Сохранить'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={editBusy}
                                onClick={() => setEditing(null)}>Отмена</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#1b2622] truncate">{d.title}</div>
                        <div className="text-xs text-ink-soft">
                          {fmtSize(d.size)} · {d.uploaded_at.slice(0, 16).replace('T', ' ')}
                        </div>
                      </div>
                      <button className="btn btn-ghost btn-sm ml-auto" onClick={() => startEdit(d)}
                              title="Переименовать или сменить категорию"
                              aria-label={'Править ' + d.title}>
                        <Icon name="edit" size={16} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => recognize(d)}
                              disabled={ocrBusy || (!d.ocr.enabled && d.ocr.status !== 'ready')}
                              title={d.ocr.status === 'ready' ? 'Показать распознанный текст' : d.ocr.enabled ? 'Распознать на сервере клиники' : 'Серверный OCR не включён'}
                              aria-label={'Распознать ' + d.title}>
                        <Icon name="sparkle" size={16} />
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => download(d)} aria-label={'Скачать ' + d.title}>
                        <Icon name="download" size={16} />
                      </button>
                      <button className="btn btn-ghost btn-sm text-coral" onClick={() => remove(d)} aria-label={'Удалить ' + d.title}>
                        <Icon name="trash" size={16} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
