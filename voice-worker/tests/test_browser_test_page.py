import asyncio
import base64
import json
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import app.bot as bot
import app.main as main
from app.browser import BROWSER_RATE, BrowserSerializer, demo_session
from app.config import Settings
from app.guard import classify


def settings(**over):
    base = dict(worker_secret="s", app_events_url="https://app.test/e", sarvam_api_key="k", llm_provider="google",
                llm_model="m", llm_api_key="k", tts_voice="", session_ttl_seconds=300, test_page_token="letmein")
    base.update(over)
    return Settings(**base)


async def test_serializer_roundtrip_and_clear():
    s = BrowserSerializer()
    from pipecat.frames.frames import InputAudioRawFrame, InterruptionFrame, OutputAudioRawFrame
    s._sample_rate = BROWSER_RATE
    pcm = (b"\x01\x00" * 320)
    frame = await s.deserialize(json.dumps({"event": "media", "media": {"payload": base64.b64encode(pcm).decode()}}))
    assert isinstance(frame, InputAudioRawFrame) and frame.sample_rate == BROWSER_RATE and frame.num_channels == 1
    out = await s.serialize(OutputAudioRawFrame(audio=pcm, sample_rate=BROWSER_RATE, num_channels=1))
    assert json.loads(out)["event"] == "media"
    assert json.loads(await s.serialize(InterruptionFrame()))["event"] == "clear"


async def test_serializer_ignores_garbage():
    s = BrowserSerializer()
    s._sample_rate = BROWSER_RATE
    assert await s.deserialize("not json") is None
    assert await s.deserialize(json.dumps({"event": "other"})) is None
    assert await s.deserialize(json.dumps({"event": "media", "media": {}})) is None


def test_page_is_absent_without_token(monkeypatch):
    monkeypatch.setattr(main, "settings", settings(test_page_token=""))
    c = TestClient(main.app)
    assert c.get("/test").status_code == 404


def test_page_served_and_websocket_needs_the_key(monkeypatch):
    monkeypatch.setattr(main, "settings", settings())
    c = TestClient(main.app)
    r = c.get("/test")
    assert r.status_code == 200 and "Talk to Riya" in r.text
    with pytest.raises(Exception):
        with c.websocket_connect("/test/ws?key=wrong") as ws:
            ws.receive_text()


def test_websocket_refuses_when_keys_missing(monkeypatch):
    monkeypatch.setattr(main, "settings", settings(sarvam_api_key=""))
    c = TestClient(main.app)
    with pytest.raises(Exception):
        with c.websocket_connect("/test/ws?key=letmein") as ws:
            ws.receive_text()


def test_demo_session_is_fictional_and_approved():
    s = demo_session("hi-IN")
    assert s.kb_status == "approved" and s.language == "hi-IN" and s.lead_id == "test"
    assert "demo" in json.dumps(s.facts).lower()


class FakeRunner:
    def __init__(self, **_):
        pass

    async def run(self, task):
        return None


async def test_gemini_browser_call_builds_and_logs_instead_of_posting(monkeypatch):
    monkeypatch.setattr(bot, "PipelineRunner", FakeRunner)
    sent = []

    class Ev:
        async def send(self, e):
            sent.append(e)
            return True

        async def aclose(self):
            pass

    await bot.run_call(MagicMock(), "browser", {}, demo_session("en-IN"), settings(), sample_rate=BROWSER_RATE, events=Ev())
    assert sent and sent[-1]["type"] == "call_ended" and sent[-1]["outcome"] == "no_response"


def test_test_lock_blocks_a_second_call():
    async def go():
        async with main._test_lock:
            return main._test_lock.locked()
    assert asyncio.run(go()) is True


def _client(monkeypatch, **over):
    monkeypatch.setattr(main, "settings", settings(**over))
    monkeypatch.setattr(main, "sessions", main.SessionStore(300))
    return TestClient(main.app)


def test_crm_token_is_single_use_and_unknown_token_refused(monkeypatch):
    c = _client(monkeypatch)
    sess = demo_session("en-IN")
    main.sessions.put("tok", sess)
    ran = {}

    async def fake_run(ws, kind, data, session, st, **kw):
        ran["session"] = session
        ran["events"] = kw["events"]

    monkeypatch.setattr(bot, "run_call", fake_run)
    with c.websocket_connect("/test/ws?token=tok"):
        pass
    assert ran["session"].call_id == sess.call_id
    assert type(ran["events"]).__name__ == "EventClient"  # reports to the CRM, unlike the demo's LogEvents
    with pytest.raises(Exception):
        with c.websocket_connect("/test/ws?token=tok"):
            pass
    with pytest.raises(Exception):
        with c.websocket_connect("/test/ws?token=nope"):
            pass


def test_call_page_needs_token(monkeypatch):
    c = _client(monkeypatch)
    assert c.get("/test/call").status_code == 404
    assert c.get("/test/call?token=x").status_code == 200
