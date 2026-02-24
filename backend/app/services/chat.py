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
        "history": _compact_forecast(forecast_payload.get("history", []), max_points=120),
        "forecast": _compact_forecast(forecast_payload.get("forecast", []), max_points=60),
    }


def _get_client_and_model() -> tuple[Any, str]:
    from openai import OpenAI
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required.")
    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    return OpenAI(api_key=api_key), model


def answer_question(
    upload: Upload,
    question: str,
    history: list[dict[str, str]] | None = None,
) -> ChatResponse:
    client, model = _get_client_and_model()

    artifact_path = upload.last_forecast_path
    if not artifact_path or not Path(artifact_path).exists():
        raise ValueError("Forecast not available for this upload. Generate forecast first.")

    payload = json.loads(Path(artifact_path).read_text(encoding="utf-8"))
    context = _build_context(upload, payload)

    system_prompt = (
        "You are a senior energy forecasting analyst. Use only the provided JSON context — no external knowledge.\n"
        "Format every response in clean Markdown:\n"
        "- Use **bold** for key numbers, dates, and metric names\n"
        "- Use bullet lists for multiple findings or factors\n"
        "- Use `### Section` headers when the answer has 2+ distinct topics\n"
        "- Use `code` style for specific numeric values (e.g. `312.4 MWh`)\n"
        "- Use a `---` divider before a summary or accuracy line\n"
        "- Keep each bullet to one sentence. No filler phrases.\n"
        "- If context is insufficient, say so directly in one line."
    )

    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]

    # Inject prior conversation turns for memory
    if history:
        for turn in history:
            messages.append({"role": turn["role"], "content": turn["content"]})

    user_content = f"**Question:** {question}\n\n**Context JSON:**\n{json.dumps(context, ensure_ascii=True)}"
    messages.append({"role": "user", "content": user_content})

    completion = client.responses.create(model=model, input=messages)
    answer = completion.output_text.strip()
    if not answer:
        answer = "Insufficient context to answer reliably from the available forecast outputs."

    sources: list[Literal["forecast", "metrics", "risk", "features"]] = ["forecast", "metrics", "risk", "features"]
    return ChatResponse(answer=answer, sources=sources)


def generate_auto_analysis(upload: Upload) -> ChatResponse:
    """Generate a schedule-of-events forecast briefing automatically after forecast runs."""
    client, model = _get_client_and_model()

    artifact_path = upload.last_forecast_path
    if not artifact_path or not Path(artifact_path).exists():
        raise ValueError("Forecast artifact not found.")

    payload = json.loads(Path(artifact_path).read_text(encoding="utf-8"))
    context = _build_context(upload, payload)

    system_prompt = (
        "You are a senior energy forecasting analyst briefing control room operators.\n"
        "Produce a FORECAST BRIEF in Markdown using this exact structure:\n\n"
        "[2–3 sentence plain-English executive summary: overall trend direction, dominant peak/trough, "
        "and one headline risk. No section header — just the paragraph.]\n\n"
        "### Schedule of Events\n"
        "- **[Date or range]** — [one sentence, specific P50 value, notable pattern]\n"
        "  *(repeat for each meaningful period — weekends, peaks, troughs, wide uncertainty)*\n\n"
        "### Key Risks\n"
        "- [bullet per risk: high uncertainty, anomaly, sharp ramp, etc.]\n\n"
        "---\n"
        "**Accuracy** — MAE `[value]` | sMAPE `[value]%` | Peak error `[value]`\n\n"
        "Rules:\n"
        "- Use **bold** for dates and `code` for numeric values\n"
        "- Group consecutive similar days (e.g., Apr 1–3)\n"
        "- Maximum 8 schedule bullets + 3 risk bullets\n"
        "- No filler phrases. No hedging. Every bullet must carry a fact."
    )
    user_prompt = f"**Forecast context JSON:**\n{json.dumps(context, ensure_ascii=True)}"

    completion = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    answer = completion.output_text.strip()
    if not answer:
        answer = "Analysis unavailable."

    sources: list[Literal["forecast", "metrics", "risk", "features"]] = ["forecast", "metrics"]
    return ChatResponse(answer=answer, sources=sources)
