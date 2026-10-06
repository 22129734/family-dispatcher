"""Окружение тестов: задаётся до первого импорта приложения.

SQLite в памяти, без LLM и без сети. Модуль app.db создаёт движок при импорте,
поэтому переменные должны быть выставлены раньше любого `import app...`.
"""

import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["LLM_API_KEY"] = ""
os.environ["LLM_MODEL"] = ""
os.environ["ADMIN_TOKEN"] = "admin"
os.environ["APP_ENV"] = "test"
