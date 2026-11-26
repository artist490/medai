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
from ..services.audit import record
from ..services import ocr

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


def _doc_payload(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in ("id", "title", "filename", "mime", "size", "uploaded_at")} | {
        "ocr": ocr.ocr_payload(row),
    }


def _owned_document(db: sqlite3.Connection, doc_id: int, user_id: int) -> sqlite3.Row:
    row = db.execute("SELECT * FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id)).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    return row


@router.post("", status_code=201)
def upload_document(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    # Читаем максимум MAX_SIZE+1 байт: клиент может послать 2 ГБ —
    # не тащим их в память целиком ради проверки размера.
    data = file.file.read(MAX_SIZE + 1)
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Файл пуст")
    if len(data) > MAX_SIZE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Файл больше 8 МБ")
    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_MIME:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Поддерживаются PDF, PNG, JPG и WebP")
    kind = _detect_type(data)
    if kind is None or ALLOWED_MIME[mime] != kind:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Содержимое файла не соответствует PDF, PNG, JPG или WebP")
    filename = _safe_filename(file.filename or "document", kind)
    title = "".join(c for c in title.strip()[:200] if c.isprintable() and c not in "\r\n") or filename
    cursor = db.execute(
        """INSERT INTO documents (user_id, title, filename, mime, size, data, ocr_status)
           VALUES (?, ?, ?, ?, ?, ?, 'disabled')""",
        (user["id"], title, filename, mime, len(data), data),
    )
    db.commit()  # см. комментарий в routers/auth.py register
    row = db.execute(
        "SELECT * FROM documents WHERE id = ?",
        (cursor.lastrowid,),
    ).fetchone()
    return _doc_payload(row)


@router.get("")
def list_documents(user: sqlite3.Row = Depends(auth.get_current_user),
                   db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT * FROM documents
           WHERE user_id = ? ORDER BY uploaded_at DESC, id DESC""",
        (user["id"],),
    ).fetchall()
    return {"items": [_doc_payload(r) for r in rows]}


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
