"""Settings come from environment variables only. No secret is ever read from a request or logged."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    worker_secret: str          # shared with the LeadPilot app; signs requests in both directions
    app_events_url: str         # e.g. https://calling-real-estate-ai.vercel.app/api/voice/events
    sarvam_api_key: str
    llm_provider: str           # "anthropic" | "openai"
    llm_model: str
    llm_api_key: str
    tts_voice: str
    session_ttl_seconds: int

    @staticmethod
    def from_env() -> "Settings":
        provider = os.environ.get("LLM_PROVIDER", "anthropic").lower()
        key_name = "ANTHROPIC_API_KEY" if provider == "anthropic" else "OPENAI_API_KEY"
        default_model = "claude-haiku-4-5" if provider == "anthropic" else "gpt-4o-mini"
        return Settings(
            worker_secret=os.environ.get("VOICE_WORKER_SECRET", ""),
            app_events_url=os.environ.get("APP_EVENTS_URL", ""),
            sarvam_api_key=os.environ.get("SARVAM_API_KEY", ""),
            llm_provider=provider,
            llm_model=os.environ.get("LLM_MODEL", default_model),
            llm_api_key=os.environ.get(key_name, ""),
            tts_voice=os.environ.get("SARVAM_TTS_VOICE", ""),
            session_ttl_seconds=int(os.environ.get("SESSION_TTL_SECONDS", "300")),
        )

    def missing(self) -> list[str]:
        """Names of required settings that are empty, so startup can fail loudly instead of mid-call."""
        need = {
            "VOICE_WORKER_SECRET": self.worker_secret,
            "APP_EVENTS_URL": self.app_events_url,
            "SARVAM_API_KEY": self.sarvam_api_key,
            "LLM_API_KEY": self.llm_api_key,
        }
        return [k for k, v in need.items() if not v]
