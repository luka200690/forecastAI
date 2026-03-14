from __future__ import annotations

import io
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import cast

from dotenv import load_dotenv
load_dotenv(Path(__file__).parents[2] / ".env")

import requests as http_requests
import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import ChatMessage, ContractConfigModel, Upload
from .schemas import (
    AnalysisRequest,
    BillForecastRequest,
    BillForecastResponse,
    BillManagerResponse,
    ChatHistoryResponse,
    ChatHistoryItem,
    ChatRequest,
    ChatResponse,
    ContractConfig,
    ContractConfigResponse,
    DeleteUploadResponse,
    EnrichmentResponse,
    ForecastPoint,
    ForecastRequest,
    ForecastResponse,
    Granularity,
    ScheduleConfig,
    ScheduleResponse,
    UploadListItem,
    UploadResponse,
)
from .services.bill_analysis import analyze_energy_bill
from .services.chat import answer_question, generate_auto_analysis
from .services.enrichment import compute_summary, enrich_forecast
from .services.features import infer_granularity
from .services.forecast import generate_forecast
from .services.recommendations import generate_recommendations
from .services.weather import get_weather_forecast
from .services.alpha_energy import forecast_monthly_costs, parse_bill_csv, run_bill_manager


DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL", "")
AUTH_MODE = os.getenv("AUTH_MODE", "clerk").strip().lower()
DEV_USER_ID = os.getenv("DEV_USER_ID", "local-dev-user").strip() or "local-dev-user"

app = FastAPI(title="TalkToYourForecast API", version="0.2.0")

cors_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if AUTH_MODE not in {"clerk", "dev"}:
        raise RuntimeError("Invalid AUTH_MODE. Use 'clerk' or 'dev'.")

    if AUTH_MODE == "clerk" and not CLERK_JWKS_URL:
        raise RuntimeError("AUTH_MODE=clerk requires CLERK_JWKS_URL.")

    if AUTH_MODE == "dev":
        print(f"[auth] AUTH_MODE=dev enabled. Using DEV_USER_ID='{DEV_USER_ID}'.")
    Base.metadata.create_all(bind=engine)
    # SQLite migrations: add columns if they don't exist
    with engine.connect() as conn:
        cols = [row[1] for row in conn.execute(text("PRAGMA table_info(uploads)"))]
        migrations = [
            ("user_id",                "TEXT"),
            ("schedule_enabled",       "BOOLEAN DEFAULT 0 NOT NULL"),
            ("schedule_horizon_days",  "INTEGER DEFAULT 14 NOT NULL"),
            ("schedule_threshold",     "REAL"),
            ("schedule_frequency",     "TEXT DEFAULT 'daily' NOT NULL"),
        ]
        for col_name, col_def in migrations:
            if col_name not in cols:
                conn.execute(text(f"ALTER TABLE uploads ADD COLUMN {col_name} {col_def}"))
        conn.commit()

        # Create contract_configs table (idempotent)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS contract_configs (
                upload_id TEXT PRIMARY KEY,
                config_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(upload_id) REFERENCES uploads(id) ON DELETE CASCADE
            )
        """))
        conn.commit()

    # Start daily forecast scheduler
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    from .services.scheduler import run_scheduled_forecasts

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(run_scheduled_forecasts, CronTrigger(hour=6, minute=0), id="daily_forecast", replace_existing=True)
    _scheduler.start()
    app.state.scheduler = _scheduler


@app.on_event("shutdown")
def shutdown_event() -> None:
    if hasattr(app.state, "scheduler"):
        app.state.scheduler.shutdown(wait=False)


# ── Auth dependency ───────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _get_clerk_jwks() -> dict:
    if not CLERK_JWKS_URL:
        raise RuntimeError("CLERK_JWKS_URL is not configured.")
    resp = http_requests.get(CLERK_JWKS_URL, timeout=10)
    resp.raise_for_status()
    return resp.json()


def get_current_user(authorization: str | None = Header(default=None)) -> str:
    if AUTH_MODE == "dev":
        return DEV_USER_ID

    if AUTH_MODE != "clerk":
        raise HTTPException(status_code=500, detail="Server auth mode is invalid.")

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header.")

    token = authorization[len("Bearer "):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    try:
        jwks = _get_clerk_jwks()
        payload = jwt.decode(token, jwks, algorithms=["RS256"], options={"verify_aud": False})
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Token missing subject claim.")
        return str(sub)
    except HTTPException:
        raise
    except (JWTError, RuntimeError) as exc:
        raise HTTPException(status_code=401, detail=f"Invalid or expired token: {exc}") from exc


# ── Helper ────────────────────────────────────────────────────────────────────

def _clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip().lower() for c in df.columns]
    required = {"timestamp", "value"}
    missing = required - set(df.columns)
    if missing:
        missing_str = ", ".join(sorted(missing))
        raise HTTPException(status_code=400, detail=f"Missing required columns: {missing_str}. Required: timestamp,value")

    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
    bad_ts = df[df["timestamp"].isna()].head(3)
    if not bad_ts.empty:
        examples = bad_ts.index.tolist()
        raise HTTPException(status_code=400, detail=f"Bad timestamps detected at rows: {examples}")

    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    if df["value"].isna().any():
        raise HTTPException(status_code=400, detail="Column 'value' must be numeric.")

    df = df.dropna(subset=["timestamp", "value"]).sort_values("timestamp").reset_index(drop=True)
    if df.empty:
        raise HTTPException(status_code=400, detail="CSV contains no valid rows after parsing.")

    if "site_id" in df.columns:
        site_ids = df["site_id"].dropna().astype(str).str.strip().unique()
        if len(site_ids) > 1:
            raise HTTPException(status_code=400, detail="Multiple site_id values found. MVP supports a single series only.")
        if len(site_ids) == 1:
            df["site_id"] = site_ids[0]
    return df


def _get_upload(upload_id: str, user_id: str, db: Session) -> Upload:
    upload = db.get(Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")
    if upload.user_id and upload.user_id != user_id:
        raise HTTPException(status_code=404, detail="Upload not found.")
    return upload


# ── Upload endpoints ──────────────────────────────────────────────────────────

@app.post("/api/uploads", response_model=UploadResponse)
async def upload_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> UploadResponse:
    if file is None:
        raise HTTPException(status_code=400, detail="File is required.")
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=415, detail="Only CSV files are supported.")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        df = pd.read_csv(io.BytesIO(raw_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {exc}") from exc

    df = _clean_dataframe(df)
    granularity = infer_granularity(df)

    upload_id = str(uuid.uuid4())
    storage_path = DATA_DIR / upload_id
    storage_path.mkdir(parents=True, exist_ok=False)
    (storage_path / "raw.csv").write_bytes(raw_bytes)

    try:
        df[["timestamp", "value"] + (["site_id"] if "site_id" in df.columns else [])].to_parquet(storage_path / "clean.parquet", index=False)
    except Exception:
        df.to_csv(storage_path / "clean.csv", index=False)

    metadata = {
        "upload_id": upload_id,
        "granularity": granularity,
        "start_ts": df["timestamp"].iloc[0].isoformat(),
        "end_ts": df["timestamp"].iloc[-1].isoformat(),
        "rows": int(len(df)),
    }
    (storage_path / "metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    upload = Upload(
        id=upload_id,
        user_id=user_id,
        filename=file.filename,
        granularity=granularity,
        start_ts=df["timestamp"].iloc[0].to_pydatetime(),
        end_ts=df["timestamp"].iloc[-1].to_pydatetime(),
        rows=int(len(df)),
        storage_path=str(storage_path),
        created_at=datetime.now(timezone.utc),
    )
    db.add(upload)
    db.commit()

    return UploadResponse(
        upload_id=upload.id,
        inferred_granularity=cast(Granularity, upload.granularity),
        start_ts=upload.start_ts,
        end_ts=upload.end_ts,
        rows=upload.rows,
    )


@app.get("/api/uploads", response_model=list[UploadListItem])
def list_uploads(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> list[UploadListItem]:
    uploads = db.query(Upload).filter(Upload.user_id == user_id).order_by(Upload.created_at.desc()).all()
    items: list[UploadListItem] = []
    for up in uploads:
        metrics = None
        if up.last_forecast_path and Path(up.last_forecast_path).exists():
            try:
                payload = json.loads(Path(up.last_forecast_path).read_text(encoding="utf-8"))
                m = payload.get("metrics")
                if m:
                    from .schemas import Metrics
                    metrics = Metrics(**m)
            except Exception:
                pass
        items.append(UploadListItem(
            upload_id=up.id,
            filename=up.filename,
            granularity=cast(Granularity, up.granularity),
            rows=up.rows,
            start_ts=up.start_ts,
            end_ts=up.end_ts,
            created_at=up.created_at,
            last_forecast_at=up.last_forecast_created_at,
            metrics=metrics,
            schedule_enabled=bool(up.schedule_enabled),
            schedule_horizon_days=up.schedule_horizon_days or 14,
            schedule_threshold=up.schedule_threshold,
            schedule_frequency=up.schedule_frequency or "daily",
        ))
    return items


@app.get("/api/uploads/{upload_id}/forecast", response_model=ForecastResponse)
def get_upload_forecast(
    upload_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ForecastResponse:
    upload = _get_upload(upload_id, user_id, db)
    if not upload.last_forecast_path or not Path(upload.last_forecast_path).exists():
        raise HTTPException(status_code=404, detail="No forecast available for this upload.")

    payload = json.loads(Path(upload.last_forecast_path).read_text(encoding="utf-8"))
    response = ForecastResponse(**{k: v for k, v in payload.items() if k in ForecastResponse.model_fields})

    if response.forecast:
        start_date = response.forecast[0].ts.strftime("%Y-%m-%d")
        end_date = response.forecast[-1].ts.strftime("%Y-%m-%d")
        response.weather = get_weather_forecast(start_date, end_date, response.granularity)

    return response


@app.get("/api/uploads/{upload_id}/history", response_model=ChatHistoryResponse)
def get_upload_chat_history(
    upload_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ChatHistoryResponse:
    _get_upload(upload_id, user_id, db)
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.upload_id == upload_id)
        .order_by(ChatMessage.created_at)
        .all()
    )
    return ChatHistoryResponse(
        messages=[ChatHistoryItem(role=m.role, content=m.content) for m in msgs]  # type: ignore[arg-type]
    )


# ── Forecast endpoint ─────────────────────────────────────────────────────────

@app.post("/api/forecast", response_model=ForecastResponse)
def forecast(
    request: ForecastRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ForecastResponse:
    upload = _get_upload(request.upload_id, user_id, db)

    try:
        artifacts = generate_forecast(upload, request.horizon_days, request.threshold)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Forecast failed: {exc}") from exc

    upload.last_forecast_path = artifacts.artifact_path
    upload.last_forecast_created_at = datetime.now(timezone.utc)
    db.add(upload)
    db.commit()

    response = artifacts.response
    if response.forecast:
        start_date = response.forecast[0].ts.strftime("%Y-%m-%d")
        end_date = response.forecast[-1].ts.strftime("%Y-%m-%d")
        response.weather = get_weather_forecast(start_date, end_date, response.granularity)

    return response


# ── Chat endpoints ────────────────────────────────────────────────────────────

@app.post("/api/chat", response_model=ChatResponse)
def chat(
    request: ChatRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ChatResponse:
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    upload = _get_upload(request.upload_id, user_id, db)

    try:
        if not upload.last_forecast_path or not Path(upload.last_forecast_path).exists():
            artifacts = generate_forecast(upload, horizon_days=14, threshold=None)
            upload.last_forecast_path = artifacts.artifact_path
            upload.last_forecast_created_at = datetime.now(timezone.utc)
            db.add(upload)
            db.commit()

        # Load chat history for conversational memory
        prior = (
            db.query(ChatMessage)
            .filter(ChatMessage.upload_id == upload.id)
            .order_by(ChatMessage.created_at)
            .all()
        )
        history = [{"role": m.role, "content": m.content} for m in prior]

        response = answer_question(upload, request.question.strip(), history=history)

        # Persist this Q&A pair
        db.add(ChatMessage(upload_id=upload.id, role="user", content=request.question.strip()))
        db.add(ChatMessage(upload_id=upload.id, role="assistant", content=response.answer))
        db.commit()

    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chat failed: {exc}") from exc
    return response


@app.post("/api/analysis", response_model=ChatResponse)
def analysis(
    request: AnalysisRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ChatResponse:
    upload = _get_upload(request.upload_id, user_id, db)

    try:
        response = generate_auto_analysis(upload)
        # Save the auto-analysis as the first assistant message
        db.add(ChatMessage(upload_id=upload.id, role="assistant", content=response.answer))
        db.commit()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}") from exc
    return response


# ── Actuals ingestion ─────────────────────────────────────────────────────────

@app.post("/api/uploads/{upload_id}/actuals", response_model=ForecastResponse)
async def append_actuals(
    upload_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ForecastResponse:
    """Append new measured rows to an existing upload and re-run the forecast."""
    upload = _get_upload(upload_id, user_id, db)

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=415, detail="Only CSV files are supported.")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        new_df = pd.read_csv(io.BytesIO(raw_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {exc}") from exc

    new_df = _clean_dataframe(new_df)

    # Load existing clean data
    storage = Path(upload.storage_path)
    parquet_path = storage / "clean.parquet"
    csv_path = storage / "clean.csv"
    try:
        if parquet_path.exists():
            existing_df = pd.read_parquet(parquet_path)
        else:
            existing_df = pd.read_csv(csv_path)
            existing_df["timestamp"] = pd.to_datetime(existing_df["timestamp"], utc=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read existing data: {exc}") from exc

    # Validate granularity match
    from .services.features import infer_granularity as _infer
    new_gran = _infer(new_df)
    if new_gran != upload.granularity:
        raise HTTPException(
            status_code=400,
            detail=f"Granularity mismatch: upload is {upload.granularity}, new data is {new_gran}.",
        )

    # Deduplicate: only keep rows newer than last existing timestamp
    last_ts = existing_df["timestamp"].max()
    new_df = new_df[new_df["timestamp"] > last_ts]
    if new_df.empty:
        raise HTTPException(
            status_code=400,
            detail=f"No new rows after {last_ts.isoformat()}. All timestamps already exist.",
        )

    # Merge and save
    cols = ["timestamp", "value"] + (["site_id"] if "site_id" in existing_df.columns else [])
    merged = pd.concat([existing_df[cols], new_df[cols]], ignore_index=True).sort_values("timestamp")
    try:
        merged.to_parquet(parquet_path, index=False)
    except Exception:
        merged.to_csv(csv_path, index=False)

    # Update upload metadata
    upload.rows = int(len(merged))
    upload.end_ts = merged["timestamp"].iloc[-1].to_pydatetime()
    db.add(upload)
    db.commit()

    # Re-run forecast using same params as last forecast (or defaults)
    horizon_days: int = upload.schedule_horizon_days or 14
    threshold: float | None = upload.schedule_threshold
    if upload.last_forecast_path and Path(upload.last_forecast_path).exists():
        try:
            meta = json.loads(Path(upload.last_forecast_path).read_text(encoding="utf-8")).get("meta", {})
            horizon_days = int(meta.get("horizon_days", horizon_days))
        except Exception:
            pass

    try:
        artifacts = generate_forecast(upload, horizon_days, threshold)  # type: ignore[arg-type]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Re-forecast failed: {exc}") from exc

    upload.last_forecast_path = artifacts.artifact_path
    upload.last_forecast_created_at = datetime.now(timezone.utc)
    db.add(upload)
    db.commit()

    response = artifacts.response
    if response.forecast:
        start_date = response.forecast[0].ts.strftime("%Y-%m-%d")
        end_date = response.forecast[-1].ts.strftime("%Y-%m-%d")
        response.weather = get_weather_forecast(start_date, end_date, response.granularity)

    return response


# ── Schedule management ───────────────────────────────────────────────────────

@app.patch("/api/uploads/{upload_id}/schedule", response_model=ScheduleResponse)
def set_schedule(
    upload_id: str,
    config: ScheduleConfig,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ScheduleResponse:
    upload = _get_upload(upload_id, user_id, db)
    upload.schedule_enabled = config.enabled
    upload.schedule_horizon_days = config.horizon_days
    upload.schedule_threshold = config.threshold
    upload.schedule_frequency = config.frequency
    db.add(upload)
    db.commit()
    freq_label = {
        "daily":   "daily at 06:00 UTC",
        "weekly":  "weekly on Mon at 06:00 UTC",
        "monthly": "monthly on the 1st at 06:00 UTC",
    }.get(config.frequency, config.frequency)
    return ScheduleResponse(
        enabled=upload.schedule_enabled,
        horizon_days=upload.schedule_horizon_days,
        threshold=upload.schedule_threshold,
        frequency=upload.schedule_frequency,
        next_run_at=freq_label if config.enabled else "disabled",
    )


@app.delete("/api/uploads/{upload_id}/schedule", response_model=ScheduleResponse)
def delete_schedule(
    upload_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ScheduleResponse:
    upload = _get_upload(upload_id, user_id, db)
    upload.schedule_enabled = False
    db.add(upload)
    db.commit()
    return ScheduleResponse(
        enabled=False,
        horizon_days=upload.schedule_horizon_days,
        threshold=upload.schedule_threshold,
        frequency=upload.schedule_frequency or "daily",
        next_run_at="disabled",
    )


# ── Contract config & enrichment endpoints ────────────────────────────────────

@app.get("/api/uploads/{upload_id}/contract-config", response_model=ContractConfigResponse)
def get_contract_config(
    upload_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ContractConfigResponse:
    _get_upload(upload_id, user_id, db)   # ownership check
    row = db.get(ContractConfigModel, upload_id)
    if row is None:
        return ContractConfigResponse(upload_id=upload_id, config=None)
    config = ContractConfig.model_validate_json(row.config_json)
    return ContractConfigResponse(upload_id=upload_id, config=config)


@app.put("/api/uploads/{upload_id}/contract-config", response_model=ContractConfigResponse)
def save_contract_config(
    upload_id: str,
    body: ContractConfig,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> ContractConfigResponse:
    _get_upload(upload_id, user_id, db)
    # Force upload_id from path (ignore body.upload_id)
    config = body.model_copy(update={"upload_id": upload_id})
    row = db.get(ContractConfigModel, upload_id)
    if row is None:
        row = ContractConfigModel(
            upload_id=upload_id,
            config_json=config.model_dump_json(),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(row)
    else:
        row.config_json = config.model_dump_json()
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return ContractConfigResponse(upload_id=upload_id, config=config)


@app.post("/api/uploads/{upload_id}/enrich", response_model=EnrichmentResponse)
def enrich_upload(
    upload_id: str,
    body: ContractConfig,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> EnrichmentResponse:
    upload = _get_upload(upload_id, user_id, db)

    if upload.granularity != "hourly":
        raise HTTPException(
            status_code=400,
            detail="Cost & Risk analysis requires hourly granularity data.",
        )

    if not upload.last_forecast_path or not Path(upload.last_forecast_path).exists():
        raise HTTPException(
            status_code=404,
            detail="No forecast found for this upload. Run a forecast first.",
        )

    if (
        body.energy_price_source == "manual_flat"
        and body.flat_price_eur_mwh is None
    ):
        raise HTTPException(
            status_code=400,
            detail="flat_price_eur_mwh is required when energy_price_source is 'manual_flat'.",
        )

    if (
        body.penalty_model == "expected_exceedance_cost"
        and body.penalty_rate_eur_per_kw_period is None
    ):
        raise HTTPException(
            status_code=400,
            detail="penalty_rate_eur_per_kw_period is required when penalty_model is 'expected_exceedance_cost'.",
        )

    config = body.model_copy(update={"upload_id": upload_id})

    # Load forecast artifact
    artifact = json.loads(Path(upload.last_forecast_path).read_text(encoding="utf-8"))
    forecast_points = [ForecastPoint(**pt) for pt in artifact.get("forecast", [])]

    if not forecast_points:
        raise HTTPException(
            status_code=422,
            detail="Forecast artifact contains no forecast points.",
        )

    enriched = enrich_forecast(forecast_points, config)
    summary = compute_summary(enriched, config.risk_threshold_pct / 100.0)
    recs = generate_recommendations(enriched, config)

    return EnrichmentResponse(
        upload_id=upload_id,
        config=config,
        summary=summary,
        hourly=enriched,
        recommendations=recs,
    )


# ── Energy bill analysis ──────────────────────────────────────────────────────

@app.post("/api/energy-bill/analyze")
async def analyze_bill(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
) -> dict:
    allowed = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, "Unsupported file type. Upload a PDF or image.")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10 MB).")
    try:
        result = analyze_energy_bill(content, file.filename or "bill.pdf")
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Bill analysis failed: {exc}") from exc
    return result


# ── Alpha Energy Manager endpoints ───────────────────────────────────────────

@app.post("/api/alpha/bill-manager/analyze", response_model=BillManagerResponse)
async def alpha_bill_manager_analyze(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
) -> BillManagerResponse:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=415, detail="Only CSV files are supported.")

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        parsed = parse_bill_csv(raw_bytes)
        artifacts = run_bill_manager(parsed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Bill manager failed: {exc}") from exc

    return BillManagerResponse(**{
        "ledger": artifacts.ledger,
        "anomalies": artifacts.anomalies,
        "summary": artifacts.summary,
    })


@app.post("/api/alpha/forecasting/bill-cost", response_model=BillForecastResponse)
def alpha_forecast_bill_cost(
    request: BillForecastRequest,
    user_id: str = Depends(get_current_user),
) -> BillForecastResponse:
    try:
        artifacts = forecast_monthly_costs(
            ledger=[item.model_dump(mode="json") for item in request.ledger],
            months_ahead=request.months_ahead,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Forecasting agent failed: {exc}") from exc

    return BillForecastResponse(**{
        "forecast": artifacts.forecast,
        "metrics": artifacts.metrics,
    })


# ── Delete endpoint ───────────────────────────────────────────────────────────

@app.delete("/api/uploads/{upload_id}", response_model=DeleteUploadResponse)
def delete_upload(
    upload_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user),
) -> DeleteUploadResponse:
    upload = _get_upload(upload_id, user_id, db)

    path = Path(upload.storage_path)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)

    # ChatMessages cascade-deleted via FK ondelete=CASCADE
    db.delete(upload)
    db.commit()
    return DeleteUploadResponse(ok=True)
