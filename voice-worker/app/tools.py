"""LLM tools. Each one records an intent and reports it to the app. None of them confirms anything by itself."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .events import EventClient
from .session import CallSession


@dataclass
class CallState:
    """What happened on this call, for the final report."""
    qualification: dict[str, Any] = field(default_factory=dict)
    visit_requested: dict[str, str] | None = None
    callback_requested: dict[str, str | None] | None = None
    opted_out: bool = False
    wrong_number: bool = False
    not_interested: bool = False
    end_reason: str | None = None
    customer_spoke: bool = False

    def outcome(self) -> str:
        if self.opted_out:
            return "do_not_contact"
        if self.wrong_number:
            return "wrong_number"
        if self.not_interested:
            return "not_interested"
        if not self.customer_spoke:
            return "no_response"
        if self.visit_requested or self.qualification:
            return "interested"
        if self.callback_requested:
            return "callback_requested"
        return "connected"


# Schemas in plain dict form; bot.py converts them to the framework's tool objects.
TOOL_SPECS: list[dict[str, Any]] = [
    {"name": "record_qualification", "description": "Record what the customer says they are looking for.",
     "properties": {
         "property_type": {"type": "string", "enum": ["residential", "commercial"]},
         "configuration": {"type": "string", "description": "e.g. 2 BHK"},
         "purchase_timeline": {"type": "string", "description": "When they plan to buy, in their words"},
         "budget_inr": {"type": "number", "description": "Budget in rupees, if they stated one"},
     }, "required": []},
    {"name": "request_site_visit", "description": "The customer agreed to a day and time to visit. This only REQUESTS the visit; a person confirms it.",
     "properties": {
         "date": {"type": "string", "description": "YYYY-MM-DD"},
         "time": {"type": "string", "description": "HH:MM, 24 hour"},
     }, "required": ["date", "time"]},
    {"name": "request_callback", "description": "A colleague should call the customer back (they asked, or you could not answer).",
     "properties": {
         "reason": {"type": "string"},
         "preferred_time": {"type": "string", "description": "Their preferred time, in their words"},
     }, "required": ["reason"]},
    {"name": "record_opt_out", "description": "The customer does not want to be called again.", "properties": {}, "required": []},
    {"name": "end_call", "description": "The conversation is finished. Say goodbye first.",
     "properties": {"reason": {"type": "string"}}, "required": ["reason"]},
]


def make_handlers(session: CallSession, state: CallState, events: EventClient,
                  hangup: Callable[[], Awaitable[None]]) -> dict[str, Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]]:
    base = {"call_id": session.call_id, "org_id": session.org_id, "lead_id": session.lead_id, "project_id": session.project_id}

    async def record_qualification(a: dict[str, Any]) -> dict[str, Any]:
        state.qualification.update({k: v for k, v in a.items() if v not in (None, "")})
        return {"ok": True}

    async def request_site_visit(a: dict[str, Any]) -> dict[str, Any]:
        state.visit_requested = {"date": str(a.get("date", "")), "time": str(a.get("time", ""))}
        acked = await events.send({**base, "type": "visit_requested", **state.visit_requested})
        return {"ok": True, "status": "requested", "note": "Tell the customer it is requested and a colleague will confirm. Do not say it is booked."} if acked else \
               {"ok": True, "status": "requested", "note": "Tell the customer a colleague will confirm. Do not say it is booked."}

    async def request_callback(a: dict[str, Any]) -> dict[str, Any]:
        state.callback_requested = {"reason": str(a.get("reason", "")), "preferred_time": a.get("preferred_time")}
        await events.send({**base, "type": "callback_requested", **state.callback_requested})
        return {"ok": True}

    async def record_opt_out(_: dict[str, Any]) -> dict[str, Any]:
        state.opted_out = True
        await events.send({**base, "type": "opt_out", "source": "model_tool"})
        return {"ok": True}

    async def end_call(a: dict[str, Any]) -> dict[str, Any]:
        state.end_reason = str(a.get("reason", "done"))
        await hangup()
        return {"ok": True}

    return {
        "record_qualification": record_qualification, "request_site_visit": request_site_visit,
        "request_callback": request_callback, "record_opt_out": record_opt_out, "end_call": end_call,
    }
