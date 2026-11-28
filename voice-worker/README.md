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
pip install -r requirements-dev.txt
export VOICE_WORKER_SECRET=...   # same value as in the app (Vercel env VOICE_WORKER_SECRET)
export APP_EVENTS_URL=https://calling-real-estate-ai.vercel.app/api/voice/events
export SARVAM_API_KEY=...
export LLM_PROVIDER=anthropic    # or openai
export ANTHROPIC_API_KEY=...     # or OPENAI_API_KEY
uvicorn app.main:app --port 8080
pytest
```

## Try Riya from a browser (no phone provider needed)

Set these environment variables, start the worker, then open `/test?key=<TEST_PAGE_TOKEN>`:

```
SARVAM_API_KEY=...
LLM_PROVIDER=google            # or anthropic / openai
GOOGLE_API_KEY=...             # Gemini free tier via Google AI Studio (or ANTHROPIC_API_KEY / OPENAI_API_KEY)
TEST_PAGE_TOKEN=<a long random string you choose>
```

- Local (Windows/Mac): install Python 3.11+, then `pip install -r requirements.txt`, set the variables, `uvicorn app.main:app --port 8080`, and open `http://localhost:8080/test?key=...`. The browser allows the microphone on localhost.
- Hosted: deploy the `Dockerfile` to any host that gives you HTTPS and WebSockets (the microphone needs HTTPS). Hosting has not been tested yet.
- Use headphones. The page is fictional ("Sunrise Heights" demo), saves nothing, allows one call at a time, and ends after three minutes. Without `TEST_PAGE_TOKEN` the page does not exist.
- This checks voice, language, response speed and the safety rules. It does not check real phone-line audio.

The page's browser behaviour was tested in headless Chromium with a fake microphone against a stub server, not against a live Sarvam/LLM session.

## Flow

1. The app creates a `calls` row, then `POST /v1/calls` (signed) with that call's approved context. The worker returns a one-time `ws_path`.
2. The carrier (Exotel/Plivo) connects its audio stream to `wss://<worker>/ws?token=...`.
3. Riya says a fixed AI-disclosure opening line, then talks. Opt-outs etc. are caught by the guard before the model sees them.
4. The worker reports `opt_out`, `callback_requested`, `visit_requested` and finally `call_ended` to the app. It never marks a visit confirmed.

## Deploying to Vercel (for the browser test)

Create a Vercel project from this GitHub repo with **Root Directory = `voice-worker`**. Set `SARVAM_API_KEY`, `LLM_PROVIDER`, the matching LLM key and `TEST_PAGE_TOKEN` as environment variables (Production), and `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` (the speech/VAD libraries may exceed the standard 500 MB Python bundle).
Hobby plans cap a function at 300 seconds, which is fine for 3-minute tests but not for real customer calls. A live-call service should run on an always-on host instead. Hosting on Vercel is untested until a deploy succeeds.
