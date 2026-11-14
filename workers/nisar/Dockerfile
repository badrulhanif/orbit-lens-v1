# NISAR measurement service. Build from the repo root:
#   docker build -f workers/nisar/Dockerfile -t orbit-nisar .
FROM python:3.12-slim
WORKDIR /app
COPY workers/nisar/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY workers/nisar/reader.py workers/nisar/server.py ./
# Coastlines and state/district outlines (land-only, in-area figures).
COPY data/land.json data/boundaries.json ./
# Logs reach Render as they're printed.
ENV PORT=8787 PYTHONUNBUFFERED=1
EXPOSE 8787
CMD ["python", "server.py"]
