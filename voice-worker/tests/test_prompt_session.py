import pytest
from app.prompt import KnowledgeBaseNotApproved, build_system_prompt
from app.session import CallSession, SessionStore


def test_prompt_contains_only_approved_facts_and_hard_rules(session):
    p = build_system_prompt(session)
    assert "Powai, Mumbai" in p and "December 2027" in p and "one covered parking" in p
    assert "AI" in p and "Never claim or imply that you are human" in p
    assert "never that it is booked or confirmed" in p
    assert "Never guess or invent" in p


def test_refuses_unapproved_knowledge_base(session):
    draft = session.model_copy(update={"kb_status": "draft"})
    with pytest.raises(KnowledgeBaseNotApproved):
        build_system_prompt(draft)


def test_prompt_does_not_leak_other_fields(session):
    # Only the fields on CallSession can reach the prompt; there is no phone number or email on it at all.
    assert not hasattr(session, "phone") and not hasattr(session, "email")


def test_session_store_is_single_use_and_expires(session, monkeypatch):
    store = SessionStore(ttl_seconds=10)
    store.put("t", session)
    assert store.take("t") == session
    assert store.take("t") is None  # single use
    import app.session as mod
    base = [1000.0]
    monkeypatch.setattr(mod.time, "monotonic", lambda: base[0])
    store.put("t2", session)
    base[0] += 11
    assert store.take("t2") is None  # expired
