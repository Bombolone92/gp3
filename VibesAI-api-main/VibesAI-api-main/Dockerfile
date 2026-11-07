FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml requirements-server.txt ./
RUN pip install --no-cache-dir -e . && pip install --no-cache-dir -r requirements-server.txt
COPY vibes_api/ ./vibes_api/
COPY server/ ./server/
RUN useradd -m -u 1000 vibes && chown -R vibes:vibes /app
USER vibes
EXPOSE 8000
CMD ["python", "-m", "server"]
