"""
Safety guard: deterministic, runs BEFORE the language model on every customer utterance.

Opt-outs, wrong numbers and "are you a robot?" are never left to a model's judgement. This mirrors the rules in
src/lib/voice/riya.ts (the TypeScript engine) and adds Devanagari patterns, because Sarvam may return Hindi
transcripts in Devanagari. The Devanagari patterns have NOT been checked against real transcripts yet.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Intent = Literal["opt_out", "wrong_number", "not_interested", "ask_identity"]

_PATTERNS: list[tuple[Intent, list[str]]] = [
    ("opt_out", [
        r"(do not|don'?t|dont|never|stop|no more)\s+(call|calling|phone|contact|disturb)",
        r"remove (my|this) (number|name)",
        r"(call|phone|contact)\s+(mat|na)\s*(karo|kijiye|kare)?",
        r"(mat|na)\s+(call|phone)\s*(karo|kijiye)?",
        r"band\s+karo",
        r"(dobara|phir se|again)\s+(call|phone)?\s*(nahi|nahin|mat|not)",
        r"\bdnd\b",
        r"take me off",
        r"(कॉल|फोन|फ़ोन|संपर्क)\s*(मत|न)\s*(करो|कीजिए|करें)?",
        r"(मत|न)\s*(कॉल|फोन|फ़ोन)",
        r"बंद\s*करो",
        r"परेशान\s*(मत|न)",
        r"दोबारा.*(नहीं|मत)",
    ]),
    ("wrong_number", [
        r"wrong number", r"galat number", r"\bnot (me|my number)\b", r"no one by that name",
        r"गलत\s*नंबर", r"ग़लत\s*नंबर",
    ]),
    ("not_interested", [
        r"not interested", r"no interest", r"interested nahi", r"nahi chahiye", r"don'?t need",
        r"not looking", r"already (bought|purchased|booked)",
        r"रुचि\s*नहीं", r"इंटरेस्टेड\s*नहीं", r"नहीं\s*चाहिए", r"दिलचस्पी\s*नहीं",
    ]),
    ("ask_identity", [
        r"are you (a )?(human|robot|bot|real|ai|machine|person)", r"who (is this|are you)",
        r"kaun (bol|ho)", r"real person",
        r"रोबोट", r"इंसान", r"कौन\s*(बोल|हो)", r"असली\s*(इंसान|व्यक्ति)",
    ]),
]
_COMPILED = [(intent, [re.compile(p) for p in pats]) for intent, pats in _PATTERNS]


def classify(utterance: str) -> Intent | None:
    s = utterance.lower().strip()
    if not s:
        return None
    for intent, pats in _COMPILED:  # order matters: opt-out wins over everything else
        if any(p.search(s) for p in pats):
            return intent
    return None


@dataclass(frozen=True)
class GuardDecision:
    intent: Intent
    say: str
    end_call: bool


_SAY = {
    "en-IN": {
        "opt_out": "Understood. I won't call you again, and I'm sorry for the disturbance. Goodbye.",
        "wrong_number": "Sorry about that, I'll update our records. Have a good day.",
        "not_interested": "No problem at all, thank you for your time. Have a good day.",
        "ask_identity": "I'm Riya, an AI calling assistant from {company}. I'm not a human. Is this still a good time to talk?",
    },
    "hi-IN": {
        "opt_out": "ठीक है। मैं आपको दोबारा कॉल नहीं करूँगी, परेशानी के लिए माफ़ कीजिए। धन्यवाद।",
        "wrong_number": "माफ़ कीजिए, मैं हमारे रिकॉर्ड ठीक कर दूँगी। आपका दिन शुभ हो।",
        "not_interested": "कोई बात नहीं, आपके समय के लिए धन्यवाद। आपका दिन शुभ हो।",
        "ask_identity": "मैं रिया हूँ, {company} की तरफ़ से एक AI कॉलिंग असिस्टेंट। मैं इंसान नहीं हूँ। क्या अभी बात करना ठीक रहेगा?",
    },
}


def decide(utterance: str, *, language: str, company: str) -> GuardDecision | None:
    intent = classify(utterance)
    if intent is None:
        return None
    table = _SAY.get(language, _SAY["en-IN"])
    return GuardDecision(intent=intent, say=table[intent].format(company=company), end_call=intent != "ask_identity")


def opening_line(*, language: str, company: str, project: str) -> str:
    """Fixed, never generated: the AI disclosure and who Riya represents."""
    if language == "hi-IN":
        return f"नमस्ते, मैं रिया हूँ, {company} की तरफ़ से एक AI कॉलिंग असिस्टेंट। मैं {project} के बारे में आपकी पूछताछ के सिलसिले में कॉल कर रही हूँ। क्या अभी बात करना ठीक रहेगा?"
    return f"Hello, I'm Riya, an AI calling assistant from {company}. I'm calling regarding your enquiry about {project}. Is this a good time to speak?"
