from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

from ..models import Upload
from ..schemas import ChatResponse


def _compact_forecast(forecast: list[dict[str, Any]], max_points: int = 60) -> list[dict[str, Any]]:
    if len(forecast) <= max_points:
        return forecast
    step = max(1, len(forecast) // max_points)
    return forecast[::step][:max_points]


def _build_context(upload: Upload, forecast_payload: dict[str, Any]) -> dict[str, Any]:
    summary = {
        "upload_id": upload.id,
        "rows": upload.rows,
        "granularity": upload.granularity,
        "start_ts": upload.start_ts.isoformat(),
        "end_ts": upload.end_ts.isoformat(),
    }
    return {
        "summary": summary,
        "metrics": forecast_payload.get("metrics"),
        "feature_importance": forecast_payload.get("feature_importance", [])[:10],
        "risk": forecast_payload.get("risk"),
        "forecast": _compact_forecast(forecast_payload.get("forecast", []), max_points=60),
    }


def answer_question(upload: Upload, question: str) -> ChatResponse:
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for chat.")

    artifact_path = upload.last_forecast_path
    if not artifact_path or not Path(artifact_path).exists():
        raise ValueError("Forecast not available for this upload. Generate forecast first.")

    payload = json.loads(Path(artifact_path).read_text(encoding="utf-8"))
    context = _build_context(upload, payload)

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    client = OpenAI(api_key=api_key)
    system_prompt = (
        "You are a forecasting assistant. Use only the provided JSON context. "
        "Do not use external knowledge or raw CSV rows. "
        "If context is insufficient, say so clearly. "
        "Keep answers concise and explain uncertainty."
    )
    user_prompt = f"Question: {question}\n\nContext JSON:\n{json.dumps(context, ensure_ascii=True)}"
    completion = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    answer = completion.output_text.strip()
    if not answer:
        answer = "Insufficient context to answer reliably from the available forecast outputs."

    sources: list[Literal["forecast", "metrics", "risk", "features"]] = ["forecast", "metrics", "risk", "features"]
    return ChatResponse(answer=answer, sources=sources)
