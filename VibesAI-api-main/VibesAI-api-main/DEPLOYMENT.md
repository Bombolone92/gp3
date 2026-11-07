# Deployment

## Quick start
```bash
pip install -e ".[server]"
export VIBES_META_SESSION="your-cookie"
python -m server  # Open http://localhost:8000/docs
```

## Docker
```bash
export VIBES_META_SESSION="your-cookie"
docker compose up -d
```

## Cookie auto-refresh
- Intercepts Set-Cookie headers on every API response (sliding session)
- Background thread calls /api/auth/me every 25 minutes
- Persists to VIBES_COOKIE_FILE for restart survival

## Auth
Set VIBES_API_KEY env var. Clients send X-API-Key header.
