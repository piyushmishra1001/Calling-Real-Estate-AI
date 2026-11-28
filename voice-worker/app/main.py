from __future__ import annotations

import asyncio
import hmac
import secrets
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse
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


# ---------------------------------------------------------------- browser test page (no phone provider needed)
TEST_MAX_SECONDS = 300
_test_lock = asyncio.Lock()


@app.get("/test")
async def test_page():
    if not settings.test_page_token:
        raise HTTPException(404)
    return FileResponse(Path(__file__).parent / "static" / "test.html")


@app.websocket("/test/ws")
async def test_ws(websocket: WebSocket, key: str = "", lang: str = "en-IN"):
    """Talk to Riya from a browser. Needs TEST_PAGE_TOKEN, runs one call at a time, ends after five minutes."""
    if not settings.test_page_token or not hmac.compare_digest(key.encode(), settings.test_page_token.encode()):
        await websocket.close(code=4401)
        return
    if settings.missing_for_test():
        await websocket.close(code=1011)
        return
    if _test_lock.locked():
        await websocket.close(code=4409)
        return
    async with _test_lock:
        await websocket.accept()
        from .bot import run_call
        from .browser import BROWSER_RATE, LogEvents, demo_session
        try:
            await asyncio.wait_for(
                run_call(websocket, "browser", {}, demo_session(lang), settings, sample_rate=BROWSER_RATE, events=LogEvents()),
                timeout=TEST_MAX_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.info("Test call ended: five minute limit")
        except Exception:
            logger.exception("Test call failed")
