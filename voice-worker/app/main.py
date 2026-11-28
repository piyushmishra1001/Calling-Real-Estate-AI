from __future__ import annotations

import secrets

from fastapi import FastAPI, HTTPException, Request, WebSocket
from loguru import logger
from pydantic import ValidationError

from .config import Settings
from .events import verify
from .session import CallSession, SessionStore

settings = Settings.from_env()
sessions = SessionStore(settings.session_ttl_seconds)
app = FastAPI(title="LeadPilot voice worker")


@app.on_event("startup")
async def _check_config() -> None:
    missing = settings.missing()
    if missing:
        logger.error("Missing required settings: {}", ", ".join(missing))


@app.get("/health")
async def health():
    return {"ok": True, "configured": not settings.missing()}


@app.post("/v1/calls")
async def register_call(request: Request):
    """The app registers one call's context just before the carrier connects. Signed with the shared secret."""
    body = await request.body()
    if not verify(settings.worker_secret, request.headers.get("x-timestamp", ""), body, request.headers.get("x-signature", "")):
        raise HTTPException(401, "bad signature")
    try:
        session = CallSession.model_validate_json(body)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False))
    if session.kb_status != "approved":
        raise HTTPException(409, "knowledge base not approved")
    token = secrets.token_urlsafe(24)
    sessions.put(token, session)
    return {"token": token, "ws_path": f"/ws?token={token}"}


@app.websocket("/ws")
async def telephony_ws(websocket: WebSocket, token: str = ""):
    session = sessions.take(token)
    if session is None:
        await websocket.close(code=4401)
        return
    missing = settings.missing()
    if missing:
        logger.error("Refusing call: missing settings {}", ", ".join(missing))
        await websocket.close(code=1011)
        return
    await websocket.accept()
    from pipecat.runner.utils import parse_telephony_websocket
    from .bot import run_call
    transport_type, call_data = await parse_telephony_websocket(websocket)
    await run_call(websocket, transport_type, call_data, session, settings)
