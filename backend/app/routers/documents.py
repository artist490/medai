"""Документы пациента: загрузка результатов исследований (PDF/фото) в медкарту.

Файлы хранятся как BLOB в SQLite (макс. 8 МБ) — для локального деплоя клиники
это достаточно и не требует файловой инфраструктуры. Пациент работает только
со своими документами.
"""
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from .. import auth
from ..database import get_db

router = APIRouter(prefix="/api/documents", tags=["documents"])

MAX_SIZE = 8 * 1024 * 1024  # 8 МБ
ALLOWED_MIME = (
    "application/pdf",
    "image/png", "image/jpeg", "image/webp",
)


def _doc_payload(row: sqlite3.Row) -> dict:
    return {k: row[k] for k in ("id", "title", "filename", "mime", "size", "uploaded_at")}


@router.post("", status_code=201)
def upload_document(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    data = file.file.read()
    if not data:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Файл пуст")
    if len(data) > MAX_SIZE:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Файл больше 8 МБ")
    mime = file.content_type or "application/octet-stream"
    if mime not in ALLOWED_MIME:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "Поддерживаются PDF, PNG, JPG и WebP")
    filename = (file.filename or "document").strip()[:255]
    title = title.strip()[:200] or filename
    db.execute(
        """INSERT INTO documents (user_id, title, filename, mime, size, data)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (user["id"], title, filename, mime, len(data), data),
    )
    db.commit()  # см. комментарий в routers/auth.py register
    row = db.execute(
        "SELECT id, title, filename, mime, size, uploaded_at FROM documents WHERE id = ?",
        (db.execute("SELECT last_insert_rowid() AS id").fetchone()["id"],),
    ).fetchone()
    return _doc_payload(row)


@router.get("")
def list_documents(user: sqlite3.Row = Depends(auth.get_current_user),
                   db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT id, title, filename, mime, size, uploaded_at FROM documents
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
    disposition = "inline" if row["mime"].startswith("image/") else "attachment"
    name = (row["filename"] or "document").replace('"', "")
    return Response(
        content=row["data"],
        media_type=row["mime"],
        headers={"Content-Disposition": f'{disposition}; filename="{name}"'},
    )


@router.delete("/{doc_id}", status_code=204)
def delete_document(
    doc_id: int,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user["id"]))
    if cursor.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Документ не найден")
    db.commit()  # см. комментарий в routers/auth.py register
    return None
