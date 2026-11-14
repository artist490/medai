"""Роутер чата с ИИ-ассистентом (DeepSeek через PlusVibe, function calling)."""
import sqlite3

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field

from .. import auth, config
from ..database import get_db
from ..services import chat_agent

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


def _history_payload(rows: list[sqlite3.Row]) -> list[dict]:
    return [{"id": r["id"], "role": r["role"], "content": r["content"],
             "created_at": r["created_at"]} for r in rows]


@router.post("/send")
def send(
    data: ChatIn,
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    message = data.message.strip()
    db.execute(
        "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'user', ?)",
        (user["id"], message),
    )

    history_rows = db.execute(
        """SELECT role, content FROM chat_messages
           WHERE user_id = ? ORDER BY id DESC LIMIT ?""",
        (user["id"], chat_agent.HISTORY_LIMIT),
    ).fetchall()
    history = [{"role": r["role"], "content": r["content"]}
               for r in reversed(history_rows)]

    result = chat_agent.run(db, user, history)
    if result is None:
        reply, tools_used = ("ИИ-чат временно недоступен — проверьте подключение "
                             "к нейросети и баланс. Пока ответить могу только общими "
                             "советами: замеры делайте в одно и то же время и следите "
                             "за самочувствием."), []
    else:
        reply, tools_used = result

    db.execute(
        "INSERT INTO chat_messages (user_id, role, content) VALUES (?, 'assistant', ?)",
        (user["id"], reply),
    )
    db.commit()  # см. комментарий в routers/auth.py register
    return {"reply": reply, "tools_used": tools_used, "model": config.CHAT_MODEL}


@router.get("/history")
def history(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    rows = db.execute(
        """SELECT id, role, content, created_at FROM chat_messages
           WHERE user_id = ? ORDER BY id DESC LIMIT 50""",
        (user["id"],),
    ).fetchall()
    return {"items": _history_payload(list(reversed(rows)))}


@router.delete("", status_code=204)
def clear(
    user: sqlite3.Row = Depends(auth.get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    db.execute("DELETE FROM chat_messages WHERE user_id = ?", (user["id"],))
    db.commit()  # см. комментарий в routers/auth.py register
    return None
