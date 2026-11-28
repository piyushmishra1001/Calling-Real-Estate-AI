import httpx
import pytest
from app.events import EventClient, sign, verify
from app.tools import CallState, make_handlers


def test_signature_roundtrip_and_tamper_detection():
    body = b'{"a":1}'
    sig = sign("secret", "1000", body)
    assert verify("secret", "1000", body, sig, now=1001)
    assert not verify("secret", "1000", b'{"a":2}', sig, now=1001)   # body changed
    assert not verify("other", "1000", body, sig, now=1001)           # wrong secret
    assert not verify("secret", "1000", body, sig, now=1000 + 301)    # replay too old
    assert not verify("secret", "nope", body, sig, now=1001)


async def test_event_client_signs_and_retries_server_errors():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(500 if len(seen) < 3 else 200)

    c = EventClient("https://app.test/api/voice/events", "secret", transport=httpx.MockTransport(handler))
    assert await c.send({"type": "x"}) is True
    assert len(seen) == 3
    r = seen[-1]
    assert verify("secret", r.headers["x-timestamp"], r.content, r.headers["x-signature"])
    await c.aclose()


async def test_event_client_does_not_retry_client_errors():
    calls = []
    c = EventClient("https://app.test/e", "s", transport=httpx.MockTransport(lambda r: (calls.append(1), httpx.Response(401))[1]))
    assert await c.send({"type": "x"}) is False
    assert len(calls) == 1
    await c.aclose()


class Recorder:
    def __init__(self):
        self.events = []

    async def send(self, e):
        self.events.append(e)
        return True


async def test_visit_request_is_reported_as_requested_never_confirmed(session):
    rec, state, ended = Recorder(), CallState(), []

    async def hangup():
        ended.append(1)

    h = make_handlers(session, state, rec, hangup)
    res = await h["request_site_visit"]({"date": "2026-12-05", "time": "11:00"})
    assert rec.events[0]["type"] == "visit_requested"
    assert not any("confirm" in k for k in rec.events[0])
    assert res["status"] == "requested" and "Do not say it is booked" in res["note"]
    state.customer_spoke = True
    assert state.outcome() == "interested"


async def test_outcome_rules(session):
    s = CallState()
    assert s.outcome() == "no_response"
    s.customer_spoke = True
    assert s.outcome() == "connected"
    s.callback_requested = {"reason": "x", "preferred_time": None}
    assert s.outcome() == "callback_requested"
    s.qualification = {"configuration": "2 BHK"}
    assert s.outcome() == "interested"
    s.opted_out = True
    assert s.outcome() == "do_not_contact"  # opt-out always wins


async def test_opt_out_tool_reports_event(session):
    rec, state = Recorder(), CallState()
    h = make_handlers(session, state, rec, lambda: None)
    await h["record_opt_out"]({})
    assert state.opted_out and rec.events[0]["type"] == "opt_out" and rec.events[0]["lead_id"] == "lead-1"
