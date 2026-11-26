# Backend Dockerfile — multi-stage for small production image
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY requirements.txt requirements-lock.txt ./
RUN pip install --no-cache-dir --prefix=/install --require-hashes -r requirements-lock.txt

# --- Runtime stage ---
FROM python:3.11-slim AS runtime

WORKDIR /app

# Non-root user
RUN groupadd -r medai && useradd -r -g medai medai
RUN chown -R medai:medai /app

# Copy installed packages
COPY --from=builder /install /usr/local

# Copy app code
COPY --chown=medai:medai app ./app
COPY --chown=medai:medai alembic ./alembic
COPY --chown=medai:medai alembic.ini ./

# Environment
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Database path (can be overridden at runtime)
ENV DATABASE_PATH=/data/medai.db

# Create data directory
RUN mkdir -p /data /models && chown medai:medai /data /models
ENV LITEPARSE_MODEL_DIR=/models

USER medai

EXPOSE 8000

# Run migrations then start
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips=172.30.0.10 --limit-concurrency=100 --timeout-keep-alive=5"]