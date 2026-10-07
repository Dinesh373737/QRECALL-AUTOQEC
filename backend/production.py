"""Serve the built UI and scientific API from one Azure container."""
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .main import app

DIST = Path(__file__).resolve().parent.parent / "dist"
app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "API endpoint not found")
    candidate = (DIST / path).resolve()
    if candidate.is_relative_to(DIST.resolve()) and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(DIST / "index.html")
