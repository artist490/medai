"""Минимальный неизменяемый через API аудит доступа к медицинским данным."""
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Optional


def record(db: sqlite3.Connection, action: str, *, user_id: Optional[int] = None,
           entity: Optional[str] = None, entity_id: Optional[int] = None,
           details: Optional[dict[str, Any]] = None, ip: Optional[str] = None,
           user_agent: Optional[str] = None) -> None:
    """Не записывать ПДн, токены и содержимое документов в details."""
    db.execute(
        """INSERT INTO audit_log
           (user_id, action, entity, entity_id, details, ip, user_agent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, action, entity, entity_id,
         json.dumps(details or {}, ensure_ascii=False), ip,
         (user_agent or "")[:300], datetime.now(timezone.utc).isoformat()),
    )
