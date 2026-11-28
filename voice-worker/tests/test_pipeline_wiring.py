"""Builds the whole call pipeline with dummy keys and no network, and checks the final report. This proves the
wiring is consistent with Pipecat's API. It does NOT prove audio, latency, voice quality or any carrier works."""
from unittest.mock import MagicMock

import pytest

import app.bot as bot
from app.config import Settings


class FakeRunner:
    def __init__(self, **_):
        pass

    async def run(self, task):
        return None


class FakeEvents:
    sent: list = []

    def __init__(self, *_a, **_k):
        pass

    async def send(self, e):
        FakeEvents.sent.append(e)
        return True

    async def aclose(self):
        pass


@pytest.mark.parametrize("provider", ["anthropic", "openai"])
async def test_run_call_builds_pipeline_and_reports_call_ended(monkeypatch, session, provider):
    monkeypatch.setattr(bot, "PipelineRunner", FakeRunner)
    monkeypatch.setattr(bot, "EventClient", FakeEvents)
    FakeEvents.sent = []
    settings = Settings(worker_secret="s", app_events_url="https://app.test/e", sarvam_api_key="dummy",
                        llm_provider=provider, llm_model="m", llm_api_key="dummy", tts_voice="", session_ttl_seconds=300)
    ws = MagicMock()
    call_data = {"stream_id": "st-1", "call_id": "ca-1"}
    await bot.run_call(ws, "exotel", call_data, session, settings)
    report = FakeEvents.sent[-1]
    assert report["type"] == "call_ended" and report["call_id"] == "call-1"
    assert report["outcome"] == "no_response"            # nobody spoke: never assume a connection
    assert report["duration_source"] == "worker_clock"
    assert report["transcript"] == []


async def test_unsupported_carrier_is_rejected(session):
    with pytest.raises(ValueError):
        bot._serializer("somecarrier", {})


async def test_unapproved_knowledge_base_blocks_the_call(monkeypatch, session):
    monkeypatch.setattr(bot, "EventClient", FakeEvents)
    draft = session.model_copy(update={"kb_status": "draft"})
    settings = Settings("s", "u", "k", "anthropic", "m", "k", "", 300)
    with pytest.raises(Exception):
        await bot.run_call(MagicMock(), "exotel", {"stream_id": "a", "call_id": "b"}, draft, settings)
