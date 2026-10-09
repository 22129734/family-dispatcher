# Один образ: собранный веб-клиент + FastAPI, который отдаёт и API, и клиент.

FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build


FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WEB_DIST_DIR=/app/web/dist
WORKDIR /app/backend

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY --from=web /web/dist /app/web/dist

# Файлы к задачам — в томе /data/uploads (переживает пересборку образа)
ENV UPLOADS_DIR=/data/uploads
RUN useradd --create-home --uid 1000 app && mkdir -p /data/uploads && chown -R app /app /data/uploads
USER app

EXPOSE 8000
# Сначала миграции, потом сервер. Заголовки X-Forwarded-* приходят от Caddy.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2 --proxy-headers --forwarded-allow-ips='*'"]
