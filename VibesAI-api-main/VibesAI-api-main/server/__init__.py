"""FastAPI server exposing vibes_api as REST API."""
from .app import app, get_client
__all__ = ["app", "get_client"]
