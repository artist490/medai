"""Документы пациента: загрузка результатов исследований (PDF/фото) в медкарту.

Файлы хранятся как BLOB в SQLite (макс. 8 МБ) — для локального деплоя клиники
это достаточно и не требует файловой инфраструктуры. Пациент работает только
со своими документами.
"""
import re
import sqlite3

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from .. import auth, config
from ..database import get_db
from ..schemas import DocumentPatchIn
from ..services import doc_categories, lab_parse, ocr
from ..services.audit import record
from ..services.payloads import doc_payload

router = APIRouter(prefix="/api/documents", tags=["documents"])

MAX_SIZE = 8 * 1024 * 1024  # 8 МБ
ALLOWED_MIME = {
    "application/pdf": "pdf",
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
}


def _detect_type(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if len(data) >= 16 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _safe_filename(value: str, kind: str) -> str:
    # Только ASCII, без CR/LF, разделителей и управляющих символов.
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", value.rsplit(".", 1)[0])[:100].strip("._")
    return f"{stem or 'document'}.{kind}"


def _owned_document(db: sqlite3.Connection, doc_id: int, user_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    return row


@router.post("", status_code=201)
def upload_document(
    file: list[UploadFile] = File(...),
    title: str = Form(default=""),
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Мультизагрузка: несколько файлов в поле `file` за один запрос.

    Атомарно: если хотя бы один файл не прошёл проверку — 422 и ни одна
    запись не создаётся (пациент не остаётся с половиной бланка).
    """
    prepared: list[dict] = []
    for uploaded in file:
        # Читаем максимум MAX_SIZE+1 байт: клиент может послать 2 ГБ —
        # не тащим их в память целиком ради проверки размера.
        data = uploaded.file.read(MAX_SIZE + 1)
        if not data:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"Файл «{uploaded.filename}» пуст")
        if len(data) > MAX_SIZE:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"Файл «{uploaded.filename}» больше 8 МБ")
        mime = uploaded.content_type or "application/octet-stream"
        if mime not in ALLOWED_MIME:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                "Поддерживаются PDF, PNG, JPG и WebP")
        kind = _detect_type(data)
        if kind is None or ALLOWED_MIME[mime] != kind:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                                f"Содержимое файла «{uploaded.filename}» не соответствует PDF, PNG, JPG или WebP")
        filename = _safe_filename(uploaded.filename or "document", kind)
        # Ручное название не перезаписывается: title_source='auto' разрешает OCR
        # подставить название из распознанного бланка, 'user' — запрещает.
        user_title = "".join(c for c in title.strip()[:200] if c.isprintable() and c not in "\r\n")
        doc_title = user_title or filename
        title_source = "user" if user_title else "auto"
        prepared.append({"title": doc_title, "filename": filename, "mime": mime,
                         "data": data, "title_source": title_source})

    created: list[dict] = []
    for item in prepared:
        cursor = db.execute(
            """INSERT INTO documents (user_id, title, filename, mime, size, data, ocr_status, title_source)
               VALUES (?, ?, ?, ?, ?, ?, 'disabled', ?)""",
            (user["id"], item["title"], item["filename"], item["mime"],
             len(item["data"]), item["data"], item["title_source"]),
        )
        created.append({"id": int(cursor.lastrowid or 0), "row": item})
    db.commit()  # см. комментарий в routers/auth.py register
    # Авто-OCR сразу после загрузки: тема и название определяются без кликов.
    # Отказ enqueue (лимиты очереди) не ломает загрузку — OCR запускается кнопкой.
    for item in created:
        ocr.enqueue(item["id"], user["id"])
    rows = {
        int(r["id"]): r
        for r in db.execute(
            f"SELECT * FROM documents WHERE id IN ({', '.join('?' for _ in created)})",
            [item["id"] for item in created],
        ).fetchall()
    }
    return [doc_payload(rows[item["id"]]) for item in created]


@router.get("")
def list_documents(user: sqlite3.Row = Depends(auth.get_current_user),
                   db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT * FROM documents
           WHERE user_id = ? ORDER BY uploaded_at DESC, id DESC""",
        (user["id"],),
    ).fetchall()
    return {"items": [doc_payload(r) for r in rows]}


# ---------- Структурированные показатели (Д3, Д4) ----------

@router.get("/lab-keys")
def lab_keys(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Показатели, распознанные хотя бы в одном документе пациента — для графика."""
    rows = db.execute(
        """SELECT DISTINCT json_extract(j.value, '$.key') AS key
           FROM documents d, json_each(d.lab_values, '$.items') j
           WHERE d.user_id = ? AND d.lab_values IS NOT NULL""",
        (user["id"],),
    ).fetchall()
    items = [
        {"key": r["key"], "label": lab_parse.LAB_KEY_LABELS[r["key"]]}
        for r in rows
        if r["key"] in lab_parse.LAB_KEY_LABELS
    ]
    items.sort(key=lambda x: x["label"])
    return {"items": items}


@router.get("/lab-trend")
def lab_trend(
    key: str,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Динамика показателя по датам из всех распознанных документов пациента."""
    if key not in lab_parse.LAB_KEY_LABELS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Неизвестный показатель")
    rows = db.execute(
        """SELECT d.uploaded_at, d.title,
                  json_extract(j.value, '$.value') AS value,
                  json_extract(j.value, '$.unit') AS unit,
                  json_extract(j.value, '$.status') AS status
           FROM documents d, json_each(d.lab_values, '$.items') j
           WHERE d.user_id = ? AND json_extract(j.value, '$.key') = ?
             AND d.ocr_status = 'ready' AND d.lab_values IS NOT NULL
             AND json_extract(j.value, '$.value') IS NOT NULL
           ORDER BY d.uploaded_at, d.id""",
        (user["id"], key),
    ).fetchall()
    return {"key": key, "label": lab_parse.LAB_KEY_LABELS[key], "items": [dict(r) for r in rows]}


@router.patch("/{doc_id}")
def edit_document(
    doc_id: int,
    data: DocumentPatchIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Ручная правка названия и/или категории.

    Название переводит документ в title_source='user' (OCR не перезаписывает);
    пустая категория переклассифицирует по распознанному тексту прямо сейчас.
    """
    row = _owned_document(db, doc_id, user["id"])
    patch = data.model_dump(exclude_unset=True)
    updates: dict[str, str] = {}
    if "title" in patch:
        new_title = "".join(
            c for c in str(patch["title"]).strip()[:200] if c.isprintable() and c not in "\r\n"
        )
        if not new_title:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Название не может быть пустым")
        updates["title"] = new_title
        updates["title_source"] = "user"
    if "category" in patch:
        requested = str(patch["category"]).strip()
        known = {c.key for c in doc_categories.DOC_CATEGORIES} | {doc_categories.OTHER.key}
        if requested and requested not in known:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Неизвестная категория")
        if requested:
            updates["category"] = requested
        else:
            # «Переклассифицируй заново»: по очищенному тексту, если он есть.
            keys = set(row.keys())
            text = row["ocr_text_clean"] if "ocr_text_clean" in keys else ""
            updates["category"] = doc_categories.classify(text or "").key
    if not updates:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Нечего менять")
    sets = ", ".join(f"{k}=?" for k in updates)
    db.execute(f"UPDATE documents SET {sets} WHERE id = ?", (*updates.values(), doc_id))
    record(db, "document.edit", user_id=user["id"], entity="document", entity_id=doc_id,
           details={"titled": "title" in updates, "category": updates.get("category")})
    db.commit()  # см. комментарий в routers/auth.py register
    fresh = _owned_document(db, doc_id, user["id"])
    return doc_payload(fresh)


@router.get("/{doc_id}/download")
def download_document(
    doc_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    row = db.execute(
        "SELECT title, filename, mime, data FROM documents WHERE id = ? AND user_id = ?",
        (doc_id, user["id"]),
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    from fastapi.responses import Response
    # Не показываем загруженное содержимое как часть доверенного origin.
    disposition = "attachment"
    name = (row["filename"] or "document").replace('"', "")
    return Response(
        content=row["data"],
        media_type=row["mime"],
        headers={"Content-Disposition": f'{disposition}; filename="{name}"',
                 "Content-Security-Policy": "sandbox; default-src 'none'",
                 "Cache-Control": "private, no-store"},
    )


@router.post("/{doc_id}/ocr", status_code=202)
def start_ocr(
    doc_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    """Ставит документ в серверную очередь; сам API распознавание не выполняет."""
    if not config.ocr_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "Серверный OCR не включён администратором")
    row = _owned_document(db, doc_id, user["id"])
    if row["ocr_status"] == "ready":
        return ocr.ocr_payload(row, include_text=True)
    if row["ocr_status"] in ("pending", "processing"):
        return ocr.ocr_payload(row)
    queued = db.execute("SELECT COUNT(*) FROM documents WHERE ocr_status IN ('pending', 'processing')").fetchone()[0]
    if queued >= 20:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Очередь распознавания переполнена — повторите позже")
    if row["ocr_attempts"] >= 3:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Достигнут лимит попыток распознавания документа")
    if not ocr.enqueue(doc_id, user["id"]):
        raise HTTPException(status.HTTP_409_CONFLICT, "Документ уже обрабатывается")
    fresh = _owned_document(db, doc_id, user["id"])
    return ocr.ocr_payload(fresh)


@router.get("/{doc_id}/ocr")
def get_ocr(
    doc_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    row = _owned_document(db, doc_id, user["id"])
    return ocr.ocr_payload(row, include_text=True)


@router.delete("/{doc_id}", status_code=204)
def delete_document(
    doc_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    if cursor.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    record(db, "document.delete", user_id=user["id"], entity="document", entity_id=doc_id)
    db.commit()
    return None
