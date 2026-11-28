"""Серверный OCR: очередь SQLite → изолированный LiteParse-процесс.

Документы не отправляются в Hugging Face, внешний OCR API или LLM. Модель
загружается заранее через `lit models pull ocria-nano` после проверки лицензии.
"""
import logging
import os
import signal
import subprocess
import tempfile
import threading
from pathlib import Path

from .. import config
from ..database import db_session
from . import doc_categories, lab_parse, ocr_postprocess
from .audit import record

logger = logging.getLogger("medai.ocr")
_worker_lock = threading.Lock()
_worker_started = False
_stopping = threading.Event()


def _row_value(row, key: str, default=None):
    """sqlite3.Row бросает IndexError на отсутствующую колонку (старая БД)."""
    try:
        return row[key]
    except (IndexError, KeyError):
        return default


def ocr_payload(row, *, include_text: bool = False) -> dict:
    result = {
        "status": row["ocr_status"],
        "error": row["ocr_error"],
        "engine": row["ocr_engine"],
        "enabled": config.ocr_enabled(),
        "started_at": row["ocr_started_at"],
        "finished_at": row["ocr_finished_at"],
    }
    if include_text:
        raw = _row_value(row, "ocr_text")
        clean = _row_value(row, "ocr_text_clean")
        if not clean and raw:
            # Документы, распознанные до постобработки: чистим на чтении,
            # сохранит их backfill_postprocessed().
            clean = ocr_postprocess.clean(raw)
        result["text"] = clean or raw
        result["text_raw"] = raw
    return result


def enqueue(document_id: int, user_id: int | None = None) -> bool:
    """Атомарно ставит документ в очередь, не дублируя активную задачу."""
    if not config.ocr_enabled():
        return False
    with db_session() as db:
        if user_id is not None:
            owner = db.execute("SELECT user_id FROM documents WHERE id=?", (document_id,)).fetchone()
            if owner is None or owner["user_id"] != user_id:
                return False
        cursor = db.execute(
            """UPDATE documents SET ocr_status='pending', ocr_error=NULL,
               ocr_started_at=NULL, ocr_finished_at=NULL
               WHERE id=? AND ocr_status NOT IN ('pending', 'processing')""",
            (document_id,),
        )
        record(db, "document.ocr.enqueue", entity="document", entity_id=document_id)
        queued = cursor.rowcount > 0
    return queued


def recover_interrupted() -> None:
    """После рестарта processing не зависает навсегда."""
    with db_session() as db:
        db.execute("UPDATE documents SET ocr_status='pending' WHERE ocr_status='processing' AND ocr_attempts < 3")
        db.execute("""UPDATE documents SET ocr_status='failed',
                   ocr_error='Обработка прервана перезапуском сервера'
                   WHERE ocr_status='processing' AND ocr_attempts >= 3""")


def _claim(document_id: int | None = None) -> dict | None:
    with db_session() as db:
        row = db.execute(
            """SELECT id, user_id, filename, mime, data, title_source, uploaded_at FROM documents
               WHERE ocr_status='pending' AND (? IS NULL OR id=?)
               ORDER BY id LIMIT 1""",
            (document_id, document_id),
        ).fetchone()
        if row is None:
            return None
        claimed = db.execute(
            """UPDATE documents SET ocr_status='processing', ocr_error=NULL,
               ocr_engine=?, ocr_started_at=datetime('now', 'localtime'),
               ocr_attempts=ocr_attempts+1 WHERE id=? AND ocr_status='pending'""",
            (config.OCR_MODEL, row["id"]),
        )
        if claimed.rowcount != 1:
            return None
        job = dict(row)
    return job


def _run_liteparse(source: Path) -> str:
    """Выполняет ограниченный по времени процесс, не передаёт shell-строки."""
    command = [
        "lit", "parse", str(source), "--format", "markdown",
        "--ocr-backend", config.OCR_MODEL,
        "--max-pages", str(config.OCR_MAX_PAGES),
        "--num-workers", "1", "--quiet",
    ]
    # Веса из репозитория (backend/models) — LiteParse ищет их по этому пути.
    model_root = config.ocr_model_root()
    env = {**os.environ, "LITEPARSE_MODEL_DIR": str(model_root)} if model_root else None
    with tempfile.TemporaryFile(prefix="medai-ocr-output-") as output:
        try:
            subprocess.run(
                command, stdout=output, stderr=subprocess.PIPE, env=env,
                timeout=config.OCR_TIMEOUT, check=True,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                start_new_session=os.name != "nt",
            )
        except subprocess.CalledProcessError:
            # Подробности stderr не показываем пользователю и не пишем в журнал.
            raise RuntimeError("Не удалось распознать документ") from None
        if output.tell() > config.OCR_MAX_TEXT * 4:
            raise RuntimeError("Распознанный текст превышает допустимый размер")
        output.seek(0)
        return output.read(config.OCR_MAX_TEXT * 4 + 1).decode("utf-8", errors="replace")


def process_one(document_id: int | None = None) -> bool:
    """Обрабатывает один документ. True = задача найдена и завершена."""
    if not config.ocr_enabled():
        return False
    job = _claim(document_id)
    if job is None:
        return False
    doc_id = job["id"]
    # Колонки появились миграцией; на строках из старой БД — безопасные дефолты.
    title_source = _row_value(job, "title_source", "auto")
    uploaded_at = str(_row_value(job, "uploaded_at", "") or "")
    try:
        suffix = Path(str(job["filename"])).suffix.lower()
        if suffix not in {".pdf", ".png", ".jpg", ".webp"}:
            raise RuntimeError("Неподдерживаемый формат документа")
        with tempfile.TemporaryDirectory(prefix="medai-ocr-") as tmp:
            source = Path(tmp) / ("input" + suffix)
            source.write_bytes(job["data"])
            if os.name != "nt":
                os.chmod(tmp, 0o700)
                os.chmod(source, 0o600)
            try:
                text = _run_liteparse(source)
            except subprocess.TimeoutExpired as exc:
                if exc.process is not None:
                    if os.name == "nt":
                        subprocess.run(["taskkill", "/PID", str(exc.process.pid), "/T", "/F"],
                                       capture_output=True, timeout=10)
                    else:
                        try:
                            os.killpg(exc.process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                raise RuntimeError("Превышен лимит времени обработки") from exc
            except FileNotFoundError as exc:
                raise RuntimeError("LiteParse не установлен на сервере") from exc
            text = text.strip()
            if not text:
                raise RuntimeError("Текст на документе не найден")
            if len(text) > config.OCR_MAX_TEXT:
                raise RuntimeError("Распознанный текст превышает допустимый размер")
            # Постобработка считается один раз и сохраняется рядом с исходником.
            clean_text = ocr_postprocess.clean(text)
            if not clean_text:
                raise RuntimeError("Текст на документе не найден")
            if len(clean_text) > config.OCR_MAX_TEXT:
                clean_text = clean_text[:config.OCR_MAX_TEXT]
        with db_session() as db:
            # Категория и авто-название считаются из очищенного текста бланка;
            # ручное название (title_source='user') не перезаписывается.
            category = doc_categories.classify(clean_text)
            lab_json = lab_parse.store_json(lab_parse.parse(clean_text))
            titled = False
            if title_source == "auto":
                auto_title = doc_categories.suggest_title(clean_text, category, uploaded_at)
                db.execute(
                    """UPDATE documents SET ocr_status='ready', ocr_text=?, ocr_text_clean=?,
                       ocr_error=NULL, ocr_finished_at=datetime('now', 'localtime'),
                       category=?, title=?, lab_values=?
                       WHERE id=? AND ocr_status='processing'""",
                    (text, clean_text, category.key, auto_title, lab_json, doc_id),
                )
                titled = True
            else:
                db.execute(
                    """UPDATE documents SET ocr_status='ready', ocr_text=?, ocr_text_clean=?,
                       ocr_error=NULL, ocr_finished_at=datetime('now', 'localtime'),
                       category=?, lab_values=?
                       WHERE id=? AND ocr_status='processing'""",
                    (text, clean_text, category.key, lab_json, doc_id),
                )
            record(db, "document.ocr.ready", user_id=job["user_id"], entity="document", entity_id=doc_id)
            # В аудит — только размеры, без содержимого документа.
            record(db, "document.ocr.postprocess", user_id=job["user_id"],
                   entity="document", entity_id=doc_id,
                   details=ocr_postprocess.analyze(text))
            # Категория без содержимого документа.
            record(db, "document.classify", user_id=job["user_id"], entity="document",
                   entity_id=doc_id, details={"category": category.key, "titled": titled})
    except Exception as exc:
        # В БД/логи не попадает текст документа, stderr или временные пути.
        logger.warning("OCR документа %s не выполнен: %s", doc_id, exc)
        with db_session() as db:
            db.execute(
                """UPDATE documents SET ocr_status='failed', ocr_error=?,
                   ocr_finished_at=datetime('now', 'localtime') WHERE id=?""",
                (str(exc)[:300], doc_id),
            )
            record(db, "document.ocr.failed", user_id=job["user_id"], entity="document", entity_id=doc_id)
    return True


def backfill_postprocessed() -> int:
    """Сохраняет очищенный текст документам, распознанным до постобработки.

    Идемпотентно: трогает только строки, где ocr_text_clean ещё не заполнен.
    """
    with db_session() as db:
        rows = db.execute(
            """SELECT id, ocr_text FROM documents
               WHERE ocr_text IS NOT NULL AND ocr_text <> ''
                 AND (ocr_text_clean IS NULL OR ocr_text_clean = '')"""
        ).fetchall()
        for row in rows:
            db.execute(
                "UPDATE documents SET ocr_text_clean=? WHERE id=?",
                (ocr_postprocess.clean(row["ocr_text"]), row["id"]),
            )
    return len(rows)


def backfill_categories() -> int:
    """Классифицирует готовые документы без категории (идемпотентно).

    Готовым до внедрения документам ставится категория по очищенному тексту;
    документы с title_source='auto' заодно получают название из бланка.
    """
    with db_session() as db:
        rows = db.execute(
            """SELECT id, ocr_text_clean, title_source, uploaded_at FROM documents
               WHERE ocr_status='ready'
                 AND ocr_text_clean IS NOT NULL AND ocr_text_clean <> ''
                 AND category = ''"""
        ).fetchall()
        for row in rows:
            category = doc_categories.classify(row["ocr_text_clean"])
            if _row_value(row, "title_source", "auto") == "auto":
                db.execute(
                    "UPDATE documents SET category=?, title=? WHERE id=?",
                    (category.key,
                     doc_categories.suggest_title(row["ocr_text_clean"], category,
                                                  str(_row_value(row, "uploaded_at", "") or "")),
                     row["id"]),
                )
            else:
                db.execute("UPDATE documents SET category=? WHERE id=?", (category.key, row["id"]))
    return len(rows)


def backfill_lab_values() -> int:
    """Структурирует показатели готовым документам без lab_values (Д2).

    Идемпотентно: lab_values IS NULL — не обработан; после парсинга остаётся
    JSON (возможно, с пустым items) — повторный прогон ничего не находит.
    """
    with db_session() as db:
        rows = db.execute(
            """SELECT id, ocr_text_clean FROM documents
               WHERE ocr_status='ready'
                 AND ocr_text_clean IS NOT NULL AND ocr_text_clean <> ''
                 AND lab_values IS NULL"""
        ).fetchall()
        for row in rows:
            db.execute(
                "UPDATE documents SET lab_values=? WHERE id=?",
                (lab_parse.store_json(lab_parse.parse(row["ocr_text_clean"])), row["id"]),
            )
    return len(rows)


def worker_loop() -> None:
    """Один процесс/worker на сервере; API не выполняет OCR в своём потоке."""
    _stopping.clear()
    recover_interrupted()
    backfill_postprocessed()
    backfill_categories()
    backfill_lab_values()
    while not _stopping.is_set():
        if not config.ocr_enabled() or not process_one():
            _stopping.wait(2)


def start_local_worker() -> None:
    """Только development: production запускает `python -m app.services.ocr`."""
    global _worker_started
    if not config.ocr_enabled() or config.ENV == "production":
        return
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True
        threading.Thread(target=worker_loop, daemon=True, name="medai-ocr-worker").start()


def stop_local_worker() -> None:
    _stopping.set()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    signal.signal(signal.SIGTERM, lambda *_: _stopping.set())
    signal.signal(signal.SIGINT, lambda *_: _stopping.set())
    worker_loop()
