# LeadPilot voice worker

Real-time voice pipeline for Riya: phone audio → Sarvam speech-to-text → **safety guard** → LLM (with tools) → Sarvam text-to-speech → phone audio. Built on Pipecat 1.17.

It is a separate always-on service (not part of the Vercel site): live calls need a constantly open audio connection. Run it in an Indian region (e.g. Mumbai).

## What is proven, and what is not

| Part | Status |
|---|---|
| Safety guard (opt-out, wrong number, not interested, "are you a robot?", English/Hinglish/Devanagari) | Unit-tested. Devanagari patterns not yet checked against real Sarvam transcripts. |
| Prompt builder (approved facts only, refuses unapproved KB, AI disclosure) | Unit-tested. |
| Signed worker → app events (same HMAC scheme on both sides) | Unit-tested both sides; the Python and TypeScript signatures were cross-checked. |
| Pipeline wiring (Pipecat + Sarvam + LLM + Exotel/Plivo serializers) | Builds with dummy keys, no network. |
| **A real phone call, voice quality, latency, Hindi accuracy, any carrier** | **Not tested. No real call has happened.** |
| Placing outbound calls through Exotel/Plivo | **Not built.** Only the audio-stream side exists. |
| Cost per minute | **Unmeasured.** Do not quote $0.02 until 100+ real calls. |

## Run

```
pip install -r requirements.txt
export VOICE_WORKER_SECRET=...   # same value as in the app (Vercel env VOICE_WORKER_SECRET)
export APP_EVENTS_URL=https://calling-real-estate-ai.vercel.app/api/voice/events
export SARVAM_API_KEY=...
export LLM_PROVIDER=anthropic    # or openai
export ANTHROPIC_API_KEY=...     # or OPENAI_API_KEY
uvicorn app.main:app --port 8080
pytest
```

## Flow

1. The app creates a `calls` row, then `POST /v1/calls` (signed) with that call's approved context. The worker returns a one-time `ws_path`.
2. The carrier (Exotel/Plivo) connects its audio stream to `wss://<worker>/ws?token=...`.
3. Riya says a fixed AI-disclosure opening line, then talks. Opt-outs etc. are caught by the guard before the model sees them.
4. The worker reports `opt_out`, `callback_requested`, `visit_requested` and finally `call_ended` to the app. It never marks a visit confirmed.
