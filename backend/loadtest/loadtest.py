"""Нагрузочный тест: постоянный поток запросов с заданной частотой (RPS).

Запросы — то, что делает приложение при открытии и обновлении экрана: страница, сессия,
семья, список дел, частые дела. Все они только читают — тест не создаёт дел и событий
и не тратит токены LLM. Нужен токен сессии тестового аккаунта (`LOADTEST_TOKEN`).

    LOADTEST_TOKEN=... python loadtest/loadtest.py https://<домен> --rps 10 20 50 --seconds 60

Кириллический домен передавайте в punycode (xn--…): urllib не кодирует его сам.

Печатает таблицу в Markdown: число запросов, ошибки, задержки p50/p95/p99 и фактический RPS.
Зависимостей нет — только стандартная библиотека.
"""

import argparse
import os
import statistics
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

# Путь и вес: на одно открытие страницы — несколько запросов API, как в приложении
MIX = [
    ("/", 1, False),
    ("/health", 1, False),
    ("/api/v1/me", 2, True),
    ("/api/v1/family", 2, True),
    ("/api/v1/tasks", 3, True),
    ("/api/v1/tasks/frequent", 1, True),
]


def plan(rps: float, seconds: int) -> list[tuple[float, str, bool]]:
    """Расписание запросов: момент отправки, путь, нужна ли авторизация."""
    order = [(path, auth) for path, weight, auth in MIX for _ in range(weight)]
    total = int(rps * seconds)
    return [(i / rps, *order[i % len(order)]) for i in range(total)]


def fetch(base: str, path: str, token: str | None, timeout: float) -> tuple[int, float]:
    request = urllib.request.Request(base + path, headers={"User-Agent": "loadtest"})
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
    except Exception:  # noqa: BLE001 — таймаут или обрыв соединения считаем ошибкой
        code = 0
    return code, (time.perf_counter() - start) * 1000


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(q / 100 * (len(values) - 1))))]


def run(base: str, rps: float, seconds: int, token: str | None, timeout: float) -> dict:
    results: dict[str, list[tuple[int, float]]] = defaultdict(list)
    lock = threading.Lock()

    def job(path: str, auth: bool) -> None:
        code, ms = fetch(base, path, token if auth else None, timeout)
        with lock:
            results[path].append((code, ms))

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=max(16, int(rps * 4))) as pool:
        for at, path, auth in plan(rps, seconds):
            delay = started + at - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            pool.submit(job, path, auth)
    elapsed = time.perf_counter() - started
    return {"rps": rps, "elapsed": elapsed, "results": results}


def report(run_result: dict) -> str:
    results = run_result["results"]
    every = [r for rows in results.values() for r in rows]
    ok = [ms for code, ms in every if 200 <= code < 400]
    errors = len(every) - len(ok)
    lines = [
        f"### {run_result['rps']:g} RPS",
        "",
        f"Отправлено {len(every)} запросов за {run_result['elapsed']:.0f} с "
        f"(фактически {len(every) / run_result['elapsed']:.1f} RPS), "
        f"ошибок {errors} ({errors / max(1, len(every)):.1%}).",
        "",
        "| Запрос | Всего | Ошибки | p50, мс | p95, мс | p99, мс |",
        "|---|---|---|---|---|---|",
    ]
    for path, rows in sorted(results.items()):
        times = [ms for code, ms in rows if 200 <= code < 400]
        bad = len(rows) - len(times)
        lines.append(
            f"| `{path}` | {len(rows)} | {bad} | {percentile(times, 50):.0f} | "
            f"{percentile(times, 95):.0f} | {percentile(times, 99):.0f} |"
        )
    lines.append(
        f"| **Все** | {len(every)} | {errors} | {percentile(ok, 50):.0f} | "
        f"{percentile(ok, 95):.0f} | {percentile(ok, 99):.0f} |"
    )
    codes = sorted({code for code, _ in every if not 200 <= code < 400})
    if codes:
        lines += ["", "Коды ошибок: " + ", ".join(str(c) for c in codes) + " (0 — таймаут)."]
    if ok:
        lines += ["", f"Средняя задержка {statistics.mean(ok):.0f} мс."]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "base", help="адрес сервиса, например https://xn--d1ababaqfaymzobir4fyc.xn--p1ai"
    )
    parser.add_argument("--rps", type=float, nargs="+", default=[10.0])
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--timeout", type=float, default=10.0)
    args = parser.parse_args()
    token = os.environ.get("LOADTEST_TOKEN")
    if not token:
        parser.error("нужен LOADTEST_TOKEN — токен сессии тестового аккаунта")
    base = args.base.rstrip("/")
    for rps in args.rps:
        print(report(run(base, rps, args.seconds, token, args.timeout)), "\n", flush=True)


if __name__ == "__main__":
    main()
