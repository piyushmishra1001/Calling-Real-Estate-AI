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
TEST_MAX_SECONDS = 180
_test_lock = asyncio.Lock()


@app.get("/test")
async def test_page():
    if not settings.test_page_token:
        raise HTTPException(404)
    return FileResponse(Path(__file__).parent / "static" / "test.html")


@app.get("/test/call")
async def test_call_page(token: str = ""):
    """Browser page for a call started from the CRM. The one-time token in the address is the credential."""
    if not token:
        raise HTTPException(404)
    return FileResponse(Path(__file__).parent / "static" / "test.html")


@app.websocket("/test/ws")
async def test_ws(websocket: WebSocket, key: str = "", lang: str = "en-IN", token: str = ""):
    """Talk to Riya from a browser, one call at a time, ending after three minutes.

    With `token` (issued by POST /v1/calls from the CRM) the call uses that lead's real, approved project facts and
    reports its result back to the CRM. With `key` (TEST_PAGE_TOKEN) it runs the fictional demo project and reports nothing.
    """
    session = None
    if token:
        session = sessions.take(token)  # single use
        if session is None:
            logger.warning("Browser test rejected: session missing, expired or already used")
            await websocket.close(code=4401)
            return
        if settings.missing():
            logger.error("Browser test rejected: missing settings {}", ", ".join(settings.missing()))
            await websocket.close(code=1011)
            return
    else:
        if not settings.test_page_token or not hmac.compare_digest(key.encode(), settings.test_page_token.encode()):
            await websocket.close(code=4401)
            return
        if settings.missing_for_test():
            await websocket.close(code=1011)
            return
    if _test_lock.locked():
        logger.warning("Browser test rejected: another test is active")
        await websocket.close(code=4409)
        return
    async with _test_lock:
        await websocket.accept()
        from .bot import run_call
        from .browser import BROWSER_RATE, LogEvents, demo_session
        from .events import EventClient
        try:
            if session is not None:
                events = EventClient(settings.app_events_url, settings.worker_secret)
                call_session = session
            else:
                events = LogEvents()
                call_session = demo_session(lang)
            await asyncio.wait_for(
                run_call(websocket, "browser", {}, call_session, settings, sample_rate=BROWSER_RATE, events=events),
                timeout=TEST_MAX_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.info("Test call ended: three minute limit")
        except Exception:
            logger.exception("Test call failed")


@app.get("/test/sarvam-llm")
async def test_sarvam_llm(key: str = ""):
    """One chat call to Sarvam's model, using the key stored in this deployment. Same token as the test page."""
    if not settings.test_page_token or not hmac.compare_digest(key.encode(), settings.test_page_token.encode()):
        raise HTTPException(404)
    if not settings.sarvam_api_key:
        return {"ok": False, "error": "SARVAM_API_KEY is not set in this deployment."}
    from sarvamai import SarvamAI

    def call() -> str:
        client = SarvamAI(api_subscription_key=settings.sarvam_api_key)
        r = client.chat.completions(model="sarvam-105b-conversations",
                                    messages=[{"role": "user", "content": "Say hello in one short sentence."}])
        return r.choices[0].message.content

    try:
        return {"ok": True, "model": "sarvam-105b-conversations", "reply": await asyncio.to_thread(call)}
    except Exception as e:  # report the failure type and message only, never the key
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}"}
