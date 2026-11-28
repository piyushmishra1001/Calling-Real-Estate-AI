"""
Signed events from the worker to the LeadPilot app.

The app is the system of record. The worker only REPORTS what happened; it never marks a site visit confirmed
(only a person or the scheduler does that), and it never writes to the database directly.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from typing import Any

import httpx


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


def verify(secret: str, timestamp: str, body: bytes, signature: str, *, max_age_seconds: int = 300, now: float | None = None) -> bool:
    try:
        age = abs((now if now is not None else time.time()) - float(timestamp))
    except ValueError:
        return False
    if age > max_age_seconds:
        return False
    return hmac.compare_digest(sign(secret, timestamp, body), signature)


class EventClient:
    def __init__(self, url: str, secret: str, *, transport: httpx.AsyncBaseTransport | None = None, retries: int = 3):
        self._url = url
        self._secret = secret
        self._retries = retries
        self._http = httpx.AsyncClient(transport=transport, timeout=10)

    async def send(self, event: dict[str, Any]) -> bool:
        """True only if the app acknowledged the event. Failures are retried, then reported to the caller."""
        body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode()
        for attempt in range(self._retries):
            ts = str(int(time.time()))
            try:
                r = await self._http.post(
                    self._url, content=body,
                    headers={"Content-Type": "application/json", "X-Timestamp": ts, "X-Signature": sign(self._secret, ts, body)},
                )
                if r.status_code < 300:
                    return True
                if r.status_code < 500:  # a client error will not fix itself on retry
                    return False
            except httpx.HTTPError:
                pass
            await asyncio.sleep(0.5 * (2 ** attempt))
        return False

    async def aclose(self) -> None:
        await self._http.aclose()
