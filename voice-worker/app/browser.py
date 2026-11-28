"""
Browser test harness: a stand-in "carrier" so Riya can be tried from a web page with no phone provider.

The wire format mirrors the Exotel media-stream style: JSON {"event":"media","media":{"payload": base64 PCM16 mono}}
in both directions at 16 kHz, plus {"event":"clear"} to drop queued speech when the customer interrupts.
This tests voice, language, response speed and the safety rules. It does NOT test real phone-line audio.
"""
from __future__ import annotations

import base64
import json
from typing import Any

from loguru import logger

from pipecat.frames.frames import AudioRawFrame, Frame, InputAudioRawFrame, InterruptionFrame
from pipecat.serializers.base_serializer import FrameSerializer

from .session import CallSession

BROWSER_RATE = 16000


class BrowserSerializer(FrameSerializer):
    class InputParams(FrameSerializer.InputParams):
        audio_in_sample_rate: int = BROWSER_RATE
        audio_out_sample_rate: int = BROWSER_RATE

    def __init__(self):
        super().__init__(BrowserSerializer.InputParams())

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, InterruptionFrame):
            await self._reset_audio_out()
            return json.dumps({"event": "clear"})
        if isinstance(frame, AudioRawFrame):
            data = await self._resample_audio_out(frame)
            if not data:
                return None
            return json.dumps({"event": "media", "media": {"payload": base64.b64encode(data).decode("ascii")}})
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        try:
            msg = json.loads(data)
        except (json.JSONDecodeError, TypeError):
            return None
        if msg.get("event") != "media":
            return None
        payload = msg.get("media", {}).get("payload")
        if not payload:
            return None
        try:
            audio = await self._resample_audio_in(base64.b64decode(payload))
        except Exception:
            return None
        return InputAudioRawFrame(audio=audio, num_channels=1, sample_rate=self._sample_rate) if audio else None


class LogEvents:
    """Test calls report nothing to the app: no call row exists, so there is nothing to update."""

    async def send(self, event: dict[str, Any]) -> bool:
        logger.info("[test call] event: {}", {k: v for k, v in event.items() if k != "transcript"})
        return True

    async def aclose(self) -> None:
        return None


def demo_session(language: str) -> CallSession:
    """Fictional project so a test call never touches real data."""
    return CallSession(
        call_id="test-call", org_id="test", lead_id="test", project_id="test",
        customer_name="Guest", company_name="Sunrise Realty", project_name="Sunrise Heights",
        language="hi-IN" if language == "hi-IN" else "en-IN", kb_status="approved",
        facts={
            "location": "Powai, Mumbai (demo project, not a real listing)",
            "configurations": "2 BHK and 3 BHK apartments",
            "possession": "December 2027 (demo)",
            "amenities": "clubhouse, swimming pool, gym, children's play area, covered parking",
        },
        faqs=[{"q": "Is covered parking included?", "a": "Yes, one covered parking space per apartment."},
              {"q": "Is there a gym?", "a": "Yes, there is a gym in the clubhouse."}],
    )
