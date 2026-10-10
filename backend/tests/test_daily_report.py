"""Утренний отчёт: балансы и метрики — без сети (MockTransport) и без отправки почты."""

from datetime import date, datetime, timedelta

import httpx
import pytest

from app.config import Settings
from app.db import Base, SessionLocal, engine
from app.models import AccountRow, ComponentCallRow, EventRow, FamilyRow, MemberRow
from app.reports import daily_report

DAY = date(2026, 10, 6)


@pytest.fixture
def db_with_day():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    at = datetime.combine(DAY, datetime.min.time()) + timedelta(hours=12)
    with SessionLocal() as db:
        db.add(AccountRow(phone="79990000001", created_at=at))
        family = FamilyRow(name="Моя семья", created_at=at)
        mom = MemberRow(name="Мама", dislikes=[])
        family.members.append(mom)
        db.add(family)
        db.flush()
        for name in ("app_open", "task_dispatched", "task_accepted", "task_done"):
            db.add(
                EventRow(member_id=mom.id, family_id=family.id, name=name, props={}, created_at=at)
            )
        db.add(
            ComponentCallRow(
                kind="llm",
                operation="chat",
                status="ok",
                tokens_in=100,
                tokens_out=20,
                created_at=at,
            )
        )
        db.add(ComponentCallRow(kind="push", operation="send", status="error", created_at=at))
        db.commit()


def http(llm_spend: float, sms_balance: float) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/key/info"):
            return httpx.Response(200, json={"info": {"spend": llm_spend, "max_budget": 50000}})
        if request.url.path == "/my/balance":
            return httpx.Response(200, json={"status": "OK", "balance": sms_balance})
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


SETTINGS = Settings(
    llm_api_key="k",
    llm_base_url="https://llm.test/v1",
    smsru_api_id="s",
    smsru_base_url="https://sms.test",
)


def test_report_has_budgets_and_metrics(db_with_day: None) -> None:
    report = daily_report.build(DAY, SETTINGS, http(4.26, 1500))
    body = report.body
    assert "потрачено 4.26 ₽ из 50 000.00 ₽" in body
    assert "SMS.RU: баланс 1 500.00 ₽" in body
    assert "DAU: 1" in body
    assert "«Беру»: 1 · «Не могу»: 0 · «Сделано»: 1" in body
    assert "Действий пользователей: 3 (3.0 на DAU)" in body  # открытие не действие
    assert "Токенов LLM: 120" in body and "Ошибки: push: 1" in body
    # Ошибок 50% — это тоже повод заглянуть в логи
    assert any("Ошибок у компонентов" in w for w in report.warnings)


def test_low_balances_raise_warnings(db_with_day: None) -> None:
    report = daily_report.build(DAY, SETTINGS, http(45000, 30))
    assert report.subject.startswith("⚠")
    assert any("LLM" in w for w in report.warnings)
    assert any("SMS.RU" in w for w in report.warnings)


def test_unavailable_source_does_not_break_report(db_with_day: None) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("нет сети")

    report = daily_report.build(DAY, SETTINGS, httpx.Client(transport=httpx.MockTransport(down)))
    assert "LLM: не удалось получить (ConnectError)" in report.body
    assert "DAU: 1" in report.body


def test_send_requires_smtp_credentials() -> None:
    with pytest.raises(RuntimeError):
        daily_report.send(daily_report.Report(day=DAY), Settings(smtp_user="", smtp_password=""))


def test_untouched_smsru_balance_is_not_a_warning(db_with_day: None) -> None:
    # Вход звонком бесплатный: 250 ₽ лежат нетронутыми — тревожиться не о чем
    report = daily_report.build(DAY, SETTINGS, http(100, 250))
    assert not any("SMS.RU" in w for w in report.warnings)
