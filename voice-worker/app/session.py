"""One call's context. The worker receives only what Riya needs; the whole CRM is never sent here."""
from __future__ import annotations

import time
from typing import Literal

from pydantic import BaseModel, Field


class CallSession(BaseModel):
    call_id: str                    # calls.id in the LeadPilot database
    org_id: str
    lead_id: str
    project_id: str
    customer_name: str
    company_name: str
    project_name: str
    language: Literal["en-IN", "hi-IN"] = "en-IN"
    kb_status: str                  # must be "approved"; anything else is refused
    facts: dict[str, str] = Field(default_factory=dict)
    faqs: list[dict[str, str]] = Field(default_factory=list)
    enquiry_type: Literal["residential", "commercial"] | None = None
    configuration: str | None = None


class SessionStore:
    """Short-lived, in-memory. A session is registered just before the provider connects and used once."""

    def __init__(self, ttl_seconds: int = 300):
        self._ttl = ttl_seconds
        self._items: dict[str, tuple[float, CallSession]] = {}

    def put(self, token: str, session: CallSession) -> None:
        self._purge()
        self._items[token] = (time.monotonic() + self._ttl, session)

    def take(self, token: str) -> CallSession | None:
        self._purge()
        item = self._items.pop(token, None)
        return item[1] if item else None

    def _purge(self) -> None:
        now = time.monotonic()
        for k in [k for k, (exp, _) in self._items.items() if exp < now]:
            del self._items[k]
