"""
The live call: phone audio -> Sarvam STT -> safety guard -> LLM (+ tools) -> Sarvam TTS -> phone audio.

STATUS: this file is written against Pipecat 1.17 and constructs cleanly in tests, but it has NOT carried a real
phone call yet. Nothing here may be described as "working on live calls" until one has succeeded end to end.
"""
from __future__ import annotations

import time
from typing import Any

from loguru import logger

from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import EndFrame, Frame, TranscriptionFrame, TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import LLMContextAggregatorPair, LLMUserAggregatorParams
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.sarvam.stt import SarvamSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transports.websocket.fastapi import FastAPIWebsocketParams, FastAPIWebsocketTransport

from .config import Settings
from .events import EventClient
from .guard import decide, opening_line
from .prompt import build_system_prompt
from .session import CallSession
from .tools import TOOL_SPECS, CallState, make_handlers

SAMPLE_RATE = 8000  # phone audio


class SafetyGuard(FrameProcessor):
    """Sits between speech-to-text and the model. Opt-outs and friends never reach the model."""

    def __init__(self, session: CallSession, state: CallState, events: EventClient, speak_and_end):
        super().__init__()
        self._s, self._state, self._events, self._speak_and_end = session, state, events, speak_and_end
        self._ended = False

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            self._state.customer_spoke = True
            if self._ended:
                return  # the call is already closing; ignore anything else the customer says
            d = decide(frame.text, language=self._s.language, company=self._s.company_name)
            if d is not None:
                base = {"call_id": self._s.call_id, "org_id": self._s.org_id, "lead_id": self._s.lead_id, "project_id": self._s.project_id}
                if d.intent == "opt_out":
                    self._state.opted_out = True
                    await self._events.send({**base, "type": "opt_out", "source": "safety_guard"})
                elif d.intent == "wrong_number":
                    self._state.wrong_number = True
                elif d.intent == "not_interested":
                    self._state.not_interested = True
                if d.end_call:
                    self._ended = True
                    self._state.end_reason = d.intent
                    await self._speak_and_end(d.say)
                else:
                    await self.push_frame(TTSSpeakFrame(d.say))
                return  # never forwarded to the model
        await self.push_frame(frame, direction)


def _build_llm(settings: Settings):
    if settings.llm_provider == "openai":
        from pipecat.services.openai.llm import OpenAILLMService
        return OpenAILLMService(api_key=settings.llm_api_key, settings=OpenAILLMService.Settings(model=settings.llm_model))
    from pipecat.services.anthropic.llm import AnthropicLLMService
    return AnthropicLLMService(api_key=settings.llm_api_key, settings=AnthropicLLMService.Settings(model=settings.llm_model))


def _serializer(transport_type: str, call_data: Any):
    if transport_type == "exotel":
        from pipecat.serializers.exotel import ExotelFrameSerializer
        return ExotelFrameSerializer(stream_sid=call_data["stream_id"], call_sid=call_data["call_id"])
    if transport_type == "plivo":
        from pipecat.serializers.plivo import PlivoFrameSerializer
        return PlivoFrameSerializer(stream_id=call_data["stream_id"], call_id=call_data["call_id"])
    raise ValueError(f"Unsupported telephony provider: {transport_type}")


def build_transcript(messages: list[Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for m in messages:
        role = m.get("role") if isinstance(m, dict) else None
        content = m.get("content") if isinstance(m, dict) else None
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            out.append({"speaker": "customer" if role == "user" else "riya", "text": content.strip()})
    return out


async def run_call(websocket, transport_type: str, call_data: Any, session: CallSession, settings: Settings) -> None:
    state = CallState()
    events = EventClient(settings.app_events_url, settings.worker_secret)
    started = {"at": None}

    system_prompt = build_system_prompt(session)  # raises if the knowledge base is not approved
    context = LLMContext(messages=[{"role": "system", "content": system_prompt}])

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(audio_in_enabled=True, audio_out_enabled=True, add_wav_header=False,
                                      serializer=_serializer(transport_type, call_data)),
    )
    stt = SarvamSTTService(api_key=settings.sarvam_api_key)
    tts_kwargs = {"voice_id": settings.tts_voice} if settings.tts_voice else {}
    tts = SarvamTTSService(api_key=settings.sarvam_api_key, **tts_kwargs)
    llm = _build_llm(settings)

    holder: dict[str, PipelineTask] = {}

    async def hangup():
        await holder["task"].queue_frames([EndFrame()])

    async def speak_and_end(text: str):
        await holder["task"].queue_frames([TTSSpeakFrame(text), EndFrame()])

    handlers = make_handlers(session, state, events, hangup)
    schemas = []
    for spec in TOOL_SPECS:
        schemas.append(FunctionSchema(name=spec["name"], description=spec["description"], properties=spec["properties"], required=spec["required"]))
        fn = handlers[spec["name"]]

        async def _handler(params: FunctionCallParams, _fn=fn):
            await params.result_callback(await _fn(dict(params.arguments)))

        llm.register_function(spec["name"], _handler)
    context.set_tools(ToolsSchema(standard_tools=schemas))

    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.5))),
    )
    guard = SafetyGuard(session, state, events, speak_and_end)

    pipeline = Pipeline([transport.input(), stt, guard, aggregators.user(), llm, tts, transport.output(), aggregators.assistant()])
    task = PipelineTask(pipeline, params=PipelineParams(audio_in_sample_rate=SAMPLE_RATE, audio_out_sample_rate=SAMPLE_RATE))
    holder["task"] = task

    @transport.event_handler("on_client_connected")
    async def _connected(_t, _c):
        started["at"] = time.monotonic()
        await task.queue_frames([TTSSpeakFrame(opening_line(language=session.language, company=session.company_name, project=session.project_name))])

    @transport.event_handler("on_client_disconnected")
    async def _disconnected(_t, _c):
        await task.cancel()

    try:
        await PipelineRunner(handle_sigint=False).run(task)
    finally:
        connected_seconds = int(time.monotonic() - started["at"]) if started["at"] else 0
        report = {
            "call_id": session.call_id, "org_id": session.org_id, "lead_id": session.lead_id, "project_id": session.project_id,
            "type": "call_ended",
            "outcome": state.outcome(),
            "end_reason": state.end_reason,
            "duration_seconds": connected_seconds,
            # The carrier's own record is authoritative for billing; this is the worker's clock and is labelled as such.
            "duration_source": "worker_clock",
            "qualification": state.qualification,
            "visit_requested": state.visit_requested,
            "callback_requested": state.callback_requested,
            "transcript": build_transcript(context.get_messages()),
        }
        if not await events.send(report):
            logger.error("call_ended event was not acknowledged by the app for call {}", session.call_id)
        await events.aclose()
