# Built with the repo root as build context (see railway.json ->
# build.dockerfilePath) so it can pick up alembic.ini and migrations/
# alongside the api/ package.

FROM python:3.12-slim

WORKDIR /app

COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY api/ ./api/
COPY alembic.ini ./alembic.ini
COPY migrations/ ./migrations/

ENV PYTHONUNBUFFERED=1

# Railway overrides this via deploy.startCommand in railway.json (which
# supplies the real $PORT); the shell-form fallback here just makes the
# image runnable standalone with `docker run`.
CMD uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}
