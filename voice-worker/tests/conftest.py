import pytest
from app.session import CallSession


@pytest.fixture
def session() -> CallSession:
    return CallSession(
        call_id="call-1", org_id="org-1", lead_id="lead-1", project_id="proj-1",
        customer_name="Asha", company_name="Sunrise Realty", project_name="Sunrise Heights",
        language="en-IN", kb_status="approved",
        facts={"location": "Powai, Mumbai", "possession": "December 2027"},
        faqs=[{"q": "Is parking included?", "a": "Yes, one covered parking per flat."}],
    )
