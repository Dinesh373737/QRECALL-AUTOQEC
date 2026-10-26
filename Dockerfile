FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html legacy.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.lock.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY results ./results
# Real Google shots only (reproducible subset of Zenodo 10.5281/zenodo.6804040; see data/google_subset/manifest.json).
COPY data/google_subset ./data/google_subset
COPY --from=frontend /app/dist ./dist
RUN useradd --uid 10001 --create-home qrecall
USER qrecall
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.production:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
