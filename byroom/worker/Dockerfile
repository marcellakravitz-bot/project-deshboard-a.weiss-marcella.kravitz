# By Room processing job — runs on Google Cloud Run Jobs, only while a file is being processed.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
# poppler: PDF words with positions (pdftotext -bbox)
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY byroom_worker ./byroom_worker
ENTRYPOINT ["python", "-m", "byroom_worker.main"]
