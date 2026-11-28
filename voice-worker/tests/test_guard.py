import pytest
from app.guard import classify, decide, opening_line


@pytest.mark.parametrize("text,intent", [
    ("please don't call me again", "opt_out"),
    ("stop calling me", "opt_out"),
    ("mujhe call mat karo", "opt_out"),
    ("band karo ye calls", "opt_out"),
    ("मुझे कॉल मत करो", "opt_out"),
    ("फोन मत करना", "opt_out"),
    ("this is a wrong number", "wrong_number"),
    ("galat number hai", "wrong_number"),
    ("गलत नंबर है", "wrong_number"),
    ("I'm not interested", "not_interested"),
    ("interested nahi hoon", "not_interested"),
    ("रुचि नहीं है", "not_interested"),
    ("are you a robot?", "ask_identity"),
    ("kaun bol raha hai", "ask_identity"),
    ("क्या आप रोबोट हो", "ask_identity"),
])
def test_classifies_safety_intents(text, intent):
    assert classify(text) == intent


@pytest.mark.parametrize("text", ["tell me about the price", "2 BHK please", "yes tomorrow works", "haan ji", "", "   "])
def test_normal_speech_is_left_to_the_model(text):
    assert classify(text) is None


def test_opt_out_beats_other_intents():
    assert classify("I'm not interested, don't call me again") == "opt_out"


def test_opt_out_ends_the_call_and_identity_does_not():
    d = decide("don't call me", language="en-IN", company="Sunrise Realty")
    assert d and d.end_call and "won't call you again" in d.say
    i = decide("are you a bot", language="en-IN", company="Sunrise Realty")
    assert i and not i.end_call and "not a human" in i.say and "Sunrise Realty" in i.say


def test_hindi_replies_are_used_for_hindi_calls():
    d = decide("call mat karo", language="hi-IN", company="Sunrise Realty")
    assert d and "कॉल नहीं करूँगी" in d.say


def test_opening_line_always_discloses_ai():
    assert "AI calling assistant" in opening_line(language="en-IN", company="X", project="Y")
    assert "AI" in opening_line(language="hi-IN", company="X", project="Y")
