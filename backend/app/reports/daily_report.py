"""Утренний отчёт команде на почту: бюджет LLM, баланс SMS.RU, метрики за вчера.

Запускается по расписанию на сервере (cron, 08:00 МСК):

    docker compose exec -T app python -m app.reports.daily_report

С флагом `--print` отчёт печатается и никуда не отправляется. Это служебная рассылка,
а не действие пользователя, поэтому в журнал обращений она не пишется.
"""

import argparse
import logging
import smtplib
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from email.message import EmailMessage

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import SessionLocal
from app.models import (
    AccountRow,
    ComponentCallRow,
    EventRow,
    FamilyRow,
    PushSubscriptionRow,
    TaskRow,
)
from app.services.metrics import real_users, team_family_ids, team_member_ids

logger = logging.getLogger(__name__)

# Предупреждаем заранее, пока есть время пополнить
LLM_WARN_SHARE = 0.8
SMSRU_WARN_RUB = 300.0
PASSIVE = {
    "app_open",
    "screen_view",
    "pwa_opened",
    "push_opened",
    "install_prompt_shown",
    "push_prompt_shown",
}


@dataclass
class Report:
    day: date
    lines: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def section(self, title: str) -> None:
        self.lines += ["", title]

    def add(self, text: str) -> None:
        self.lines.append(f"  {text}")

    @property
    def subject(self) -> str:
        mark = "⚠ " if self.warnings else ""
        return f"{mark}Семейный диспетчер — отчёт за {self.day:%d.%m.%Y}"

    @property
    def body(self) -> str:
        head = [f"Отчёт за {self.day:%d.%m.%Y} (сутки по Москве)."]
        if self.warnings:
            head += ["", "ВНИМАНИЕ:"] + [f"  • {w}" for w in self.warnings]
        return "\n".join(head + self.lines) + "\n"


def _money(value: float) -> str:
    return f"{value:,.2f}".replace(",", " ") + " ₽"


# ---------- внешние балансы ----------


def llm_budget(settings: Settings, client: httpx.Client) -> tuple[float, float] | None:
    """(потрачено, лимит) по ключу на шлюзе LiteLLM программы."""
    if not settings.llm_api_key:
        return None
    base = settings.llm_base_url.removesuffix("/").removesuffix("/v1")
    response = client.get(
        f"{base}/key/info", headers={"Authorization": f"Bearer {settings.llm_api_key}"}
    )
    response.raise_for_status()
    info = response.json()["info"]
    return float(info.get("spend") or 0), float(info.get("max_budget") or 0)


def smsru_balance(settings: Settings, client: httpx.Client) -> float | None:
    if not settings.smsru_api_id:
        return None
    response = client.get(
        f"{settings.smsru_base_url}/my/balance",
        params={"api_id": settings.smsru_api_id, "json": 1},
    )
    response.raise_for_status()
    data = response.json()
    if data.get("status") != "OK":
        raise ValueError(data.get("status_text") or "SMS.RU вернул ошибку")
    return float(data["balance"])


# ---------- метрики ----------


def _dau(db: Session, start: datetime, end: datetime, team: set[str]) -> set[str]:
    return (
        set(
            db.scalars(
                select(EventRow.member_id).where(
                    EventRow.created_at >= start, EventRow.created_at < end
                )
            )
        )
        - team
    )


def collect(db: Session, report: Report, settings: Settings, client: httpx.Client) -> None:
    start = datetime.combine(report.day, time())
    end = start + timedelta(days=1)

    report.section("Бюджеты")
    try:
        budget = llm_budget(settings, client)
        if budget is None:
            report.add("LLM: ключ не задан")
        else:
            spent, limit = budget
            share = spent / limit if limit else 0
            report.add(
                f"LLM: потрачено {_money(spent)} из {_money(limit)} ({share:.1%}), "
                f"осталось {_money(limit - spent)}"
            )
            if share >= LLM_WARN_SHARE:
                report.warnings.append(f"Бюджет LLM израсходован на {share:.0%}")
    except Exception as exc:  # отчёт должен уйти, даже если один источник недоступен
        logger.exception("LLM budget")
        report.add(f"LLM: не удалось получить ({type(exc).__name__})")
    try:
        balance = smsru_balance(settings, client)
        if balance is None:
            report.add("SMS.RU: ключ не задан")
        else:
            report.add(f"SMS.RU: баланс {_money(balance)}")
            if balance < SMSRU_WARN_RUB:
                report.warnings.append(
                    f"Баланс SMS.RU {_money(balance)} — пополните, "
                    "иначе вход звонком перестанет работать"
                )
    except Exception as exc:
        logger.exception("SMS.RU balance")
        report.add(f"SMS.RU: не удалось получить ({type(exc).__name__})")

    # Пользователи — без команды (участники хакатона и их семьи, Положение п. 5.1.3)
    team = team_member_ids(db)
    team_families = team_family_ids(db)
    dau = _dau(db, start, end, team)
    week = [
        len(_dau(db, start - timedelta(days=d), end - timedelta(days=d), team))
        for d in range(6, -1, -1)
    ]
    not_team = AccountRow.is_team.is_(False)
    accounts_total = db.scalar(select(func.count()).where(not_team)) or 0
    accounts_new = (
        db.scalar(
            select(func.count()).where(
                not_team, AccountRow.created_at >= start, AccountRow.created_at < end
            )
        )
        or 0
    )
    family_rows = db.scalars(select(FamilyRow)).all()
    families = [f for f in family_rows if f.id not in team_families]
    families_total = len(families)
    families_new = sum(1 for f in families if start <= f.created_at < end)
    real, real_in_pairs = real_users(db)

    report.section("Пользователи")
    report.add(f"Реальные пользователи (выполнили сценарий): {real} из 50 к 14.10")
    report.add(f"  из них в семьях из двух и больше: {real_in_pairs}")
    report.add(f"DAU: {len(dau)}  (7 дней: {' · '.join(map(str, week))})")
    report.add(f"Аккаунты: {accounts_total} (+{accounts_new} за день)")
    report.add(f"Семьи: {families_total} (+{families_new} за день)")
    referred_total = (
        db.scalar(select(func.count()).where(FamilyRow.referred_by_id.is_not(None))) or 0
    )
    referred_new = (
        db.scalar(
            select(func.count()).where(
                FamilyRow.referred_by_id.is_not(None),
                FamilyRow.created_at >= start,
                FamilyRow.created_at < end,
            )
        )
        or 0
    )
    report.add(f"По рекомендации: {referred_total} (+{referred_new} за день)")
    push_devices = sum(
        1
        for member_id in db.scalars(select(PushSubscriptionRow.member_id))
        if member_id not in team
    )
    report.add(f"Устройств с push: {push_devices}")
    report.add(f"Команда, не учитывается: {len(team)} чел.")

    # Сценарий «поручила — сделано»
    events = Counter(
        event.name
        for event in db.scalars(
            select(EventRow).where(EventRow.created_at >= start, EventRow.created_at < end)
        )
        if event.member_id not in team
    )
    actions = sum(n for name, n in events.items() if name not in PASSIVE)
    created = events["task_dispatched"] + events["task_created"]
    report.section("Просьбы за день")
    report.add(f"Создано: {created} (голосом и текстом — {events['task_dispatched']})")
    report.add(
        f"«Беру»: {events['task_accepted']} · «Не могу»: {events['task_declined']} · "
        f"«Сделано»: {events['task_done']}"
    )
    open_new = db.scalar(select(func.count()).where(TaskRow.status == "new")) or 0
    report.add(f"Сейчас ждут ответа исполнителя: {open_new}")
    report.add(
        f"Действий пользователей: {actions}"
        + (f" ({actions / len(dau):.1f} на DAU)" if dau else "")
    )

    # Обращения к компонентам (Положение, прил. 2, п. 2.2)
    calls = [
        call
        for call in db.scalars(
            select(ComponentCallRow).where(
                ComponentCallRow.created_at >= start, ComponentCallRow.created_at < end
            )
        )
        if call.member_id not in team
    ]
    by_kind = Counter(c.kind for c in calls)
    errors = Counter(c.kind for c in calls if c.status != "ok")
    tokens = sum((c.tokens_in or 0) + (c.tokens_out or 0) for c in calls if c.kind == "llm")
    report.section("Обращения к компонентам")
    report.add(f"Всего: {len(calls)}" + (f" ({len(calls) / len(dau):.1f} на DAU)" if dau else ""))
    if by_kind:
        report.add(", ".join(f"{kind}: {n}" for kind, n in by_kind.most_common()))
    report.add(f"Токенов LLM: {tokens}")
    if errors:
        report.add("Ошибки: " + ", ".join(f"{kind}: {n}" for kind, n in errors.most_common()))
        error_share = sum(errors.values()) / len(calls)
        if error_share >= 0.1:
            report.warnings.append(f"Ошибок у компонентов {error_share:.0%} — проверьте логи")


def send(report: Report, settings: Settings) -> None:
    if not settings.smtp_user or not settings.smtp_password:
        raise RuntimeError("SMTP_USER и SMTP_PASSWORD не заданы")
    message = EmailMessage()
    message["Subject"] = report.subject
    message["From"] = settings.smtp_user
    message["To"] = settings.report_to
    message.set_content(report.body)
    with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(message)


def build(
    day: date, settings: Settings | None = None, client: httpx.Client | None = None
) -> Report:
    settings = settings or get_settings()
    report = Report(day=day)
    with SessionLocal() as db, client or httpx.Client(timeout=20) as http:
        collect(db, report, settings, http)
    return report


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--print", action="store_true", help="напечатать, не отправлять")
    parser.add_argument("--day", type=date.fromisoformat, help="за какой день (по умолчанию вчера)")
    args = parser.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    report = build(args.day or date.today() - timedelta(days=1))
    if args.print:
        print(report.subject)
        print(report.body)
        return
    send(report, get_settings())
    print(f"Отправлено: {report.subject}")


if __name__ == "__main__":
    main()
