# Веб-MVP: техническое описание

Мобильное веб-приложение (PWA) + FastAPI-бэкенд. Ветка `feature/web-mvp`.
Общий статус проекта — [STATUS.md](STATUS.md). Принципы ядра (почему LLM не распределяет задачи) — [architecture.md](architecture.md).

---

## Запуск

Нужны Python 3.12+ и Node.js 20+. Без ключа GigaChat работает резервный разбор правилами.

```bash
# Backend — http://localhost:8000/docs
cd backend
python -m venv .venv && .venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
cp ../.env.example .env
uvicorn app.main:app --reload

# Web — http://localhost:5173 (/api проксируется на :8000)
cd web
npm install
npm run dev
```

**Один процесс (как на деплое):** `npm run build` в `web/`, затем `uvicorn app.main:app` — бэкенд отдаёт собранный клиент из `web/dist` (настройка `WEB_DIST_DIR`), SPA-маршруты (`/join/<код>`) отдают `index.html`.

**Проверки:**

```bash
cd backend && pytest && ruff check . && ruff format --check .
cd web && npm run build          # tsc + vite build
```

**С телефона:** `npm run dev` слушает все интерфейсы — откройте адрес `http://192.168.x.x:5173`. Голосовой ввод в браузере работает только по HTTPS или на localhost.

---

## Структура

```
backend/app/
  main.py                 приложение, CORS, lifespan (create_all), раздача web/dist
  config.py               настройки из .env (pydantic-settings)
  db.py                   engine, SessionLocal, Base, get_db
  models.py               ORM: FamilyRow, MemberRow, TaskRow, EventRow
  auth.py                 Bearer-токен → MemberRow (CurrentMember, DbSession)
  api/app_routes.py       API приложения: /api/v1/...
  api/routes.py           stateless-песочница ядра: /api/v1/playground/...
  schemas/api.py          схемы запросов/ответов приложения
  schemas/family.py, task.py   доменные схемы ядра
  services/
    task_extractor.py     текст → TaskDraft (GigaChat function calling / правила)
    allocator.py          TaskDraft + Family → Assignment (детерминированно)
    gigachat_client.py    обёртка GigaChat SDK
    family_service.py     связка БД ↔ ядро: недельная нагрузка, назначение, события
backend/tests/
  test_task_extractor.py, test_allocator.py   ядро
  test_app_api.py         сквозные сценарии API (SQLite в памяти)

web/
  index.html, vite.config.ts, tsconfig.json
  public/manifest.webmanifest, sw.js, icon.svg     PWA
  src/
    main.tsx              вход, регистрация service worker (только prod)
    App.tsx               сессия, маршрут /join/<код>, вкладки, загрузка данных, тосты
    api.ts                типы и клиент API, хранение токена
    format.ts             даты, группировка задач по срокам, цвета аватаров
    useSpeech.ts          голосовой ввод (Web Speech API, ru-RU)
    index.css             Tailwind 4 + токены цветов (светлая/тёмная тема)
    components/           ui.tsx (Button, Field, Toggle, Avatar), Composer, TaskCard
    screens/              Onboarding (Welcome, Join), Today, FamilyScreen
```

---

## Модель данных

| Таблица | Ключевые поля |
|---|---|
| `families` | `id`, `name`, `invite_code` (уникальный, для ссылки `/join/<код>`) |
| `members` | `family_id`, `name`, `role` (adult/teen/child), `has_car`, `capacity_minutes` (600, у ребёнка 300), `dislikes[]`, `token` |
| `tasks` | `family_id`, `created_by_id`, `assignee_id?`, `title`, `source` (text/voice/manual), `due_at?`, `duration_minutes`, `priority`, `recurrence`, `requires_car`, `clarifying_question?`, `status` (open/done), `rationale`, `fairness_score`, `vetoed_by[]`, `completed_at?` |
| `events` | `member_id`, `family_id`, `name`, `props` (JSON), `created_at` |

- Схема создаётся `Base.metadata.create_all` при старте. **Миграций (Alembic) пока нет** — при изменении моделей локальную `*.db` проще удалить.
- Время хранится **без часового пояса** (локальное время семьи, Europe/Moscow). Клиент парсит ISO-строку без смещения как локальное время.
- **Недельная нагрузка** участника не хранится, а считается из задач текущей недели (по `due_at`, иначе `completed_at`, иначе `created_at`) — `family_service.weekly_load`. На ней работают и движок распределения, и индекс невидимого труда.

---

## API (`/api/v1`)

Авторизация — заголовок `Authorization: Bearer <token>`; токен выдаётся при создании семьи или входе по приглашению.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/families` | Создать семью и первого участника → сессия |
| GET | `/invites/{code}` | Публично: название семьи и имена участников |
| POST | `/invites/{code}/join` | Войти в семью по приглашению → сессия |
| GET / PATCH | `/me` | Текущий участник / изменить имя, машину, «избегаю» |
| GET | `/family` | Участники, код приглашения, индекс невидимого труда за неделю |
| GET | `/tasks?include_done_days=1` | Открытые задачи семьи + выполненные за N дней |
| POST | `/tasks/dispatch` | **Главный сценарий:** `{message, source}` → извлечь → распределить → сохранить |
| POST | `/tasks` | Ручное создание (с исполнителем или с автоназначением) |
| PATCH | `/tasks/{id}` | Название, срок, исполнитель (ручное назначение) |
| POST | `/tasks/{id}/done` | Выполнено; повторяющаяся (daily/weekly) порождает следующую и распределяет её |
| POST | `/tasks/{id}/reopen` | Вернуть в работу |
| POST | `/tasks/{id}/reassign` | Вето в один тап: исключить текущего и всех отказавшихся, выбрать следующего; если некому — `assignee_id = null` |
| DELETE | `/tasks/{id}` | Удалить |
| POST | `/events` | Клиентское событие: `app_open`, `screen_view`, `invite_shared` |
| GET | `/analytics/daily?days=14` | DAU и действия на DAU по дням; заголовок `X-Admin-Token` = `ADMIN_TOKEN` |

Песочница ядра без БД: `POST /api/v1/playground/tasks/extract`, `/playground/tasks/dispatch`, `/playground/family/labour-index`.

### Аналитика (метрики номинаций)

Каждое действие пишет событие в `events` (`family_created`, `family_joined`, `task_dispatched`, `task_created`, `task_done`, `task_reassigned`, `task_edited`, `task_deleted`, `profile_updated`, …).
- **DAU** — уникальные участники с любым событием за день.
- **Действия (обращения)** — все события, кроме пассивных `app_open` и `screen_view`.

Определение «обращения» в программе ещё не подтверждено организаторами — при необходимости поменять `PASSIVE_EVENTS` в `app_routes.py`.

---

## Клиент

- **Онбординг:** создать семью (название, имя, «за рулём») или войти по `/join/<код>` (имя, роль, «за рулём»). Токен — в `localStorage` (`fd.token`), чтение/запись обёрнуты в try/catch.
- **«Дела»:** приветствие и число своих дел; переключатель «Вся семья / Мои»; группы «Просрочено / Сегодня / Завтра / Позже / Без срока / Сделано». Карточка: чекбокс, срок, повтор, 🚗, «срочно», аватар исполнителя; по тапу — объяснение назначения, выбор даты, выбор исполнителя, «Не могу — передать», «Удалить». Если срок не распознан — уточняющий вопрос на карточке.
- **Поле ввода:** текст или микрофон (кнопка меняется на «отправить», когда введён текст). После отправки — тост «Поручено …».
- **«Семья»:** индекс невидимого труда (полоса долей + минуты, сделано/в работе), подсказка при перекосе ≥60%, участники, «Пригласить» (Web Share API → копирование ссылки), личные настройки.
- **Обновление данных:** опрос каждые 20 с, пока вкладка видима, и при возврате в приложение. Push и WebSocket нет.
- **PWA:** manifest + service worker кэширует оболочку, `/api/*` не кэшируется.
- **Тема:** токены цветов на `:root`, тёмная — по `prefers-color-scheme`.

---

## Решения и их причины

| Решение | Почему | Что сделать потом |
|---|---|---|
| SQLite по умолчанию, синхронный SQLAlchemy | Запуск без Docker; простые синхронные эндпоинты как в исходном ядре | PostgreSQL через `DATABASE_URL`, Alembic |
| Беспарольный вход по токену | Минимальный путь к первой задаче | СберID или вход по телефону |
| Web Speech API для голоса | Работает без бэкенда | Распознавание идёт через серверы браузера — **не подходит под 152-ФЗ**; заменить на запись аудио + SaluteSpeech/GigaAM на бэкенде |
| Опрос вместо WebSocket | Достаточно для семьи из 2–5 человек | SSE/WebSocket при необходимости |
| Старые stateless-роуты перенесены в `/playground` | Конфликт путей с API приложения | — |

---

## Известные ограничения

- Без `GIGACHAT_CREDENTIALS` название задачи = исходная фраза целиком («Сегодня срочно записать бабушку к врачу в 21»); правила понимают только «сегодня/завтра/послезавтра», «в N» (час), маркеры срочности, повторов и поездок.
- `busy_windows` (занятость по расписанию) есть в ядре, но в UI и БД не заведены — участники считаются свободными всегда.
- Объяснение назначения без GigaChat — шаблонная фраза ядра; при переназначении подставляется своя («Передано: … свободнее тех, кто не смог взять задачу»).
- Нет push-напоминаний, утреннего дайджеста, эскалации просроченного.
- Нет ролевых ограничений (ребёнок может удалить любую задачу семьи).
- `monthly`-повтор не порождает следующую задачу (только daily и weekly).
- Нет frontend-тестов; линтер для TS не настроен (проверка — `tsc` в `npm run build`).
