from __future__ import annotations

import io
import json
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import cast

import pandas as pd
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import Upload
from .schemas import (
    Granularity,
    ChatRequest,
    ChatResponse,
    DeleteUploadResponse,
    ForecastRequest,
    ForecastResponse,
    UploadResponse,
)
from .services.chat import answer_question
from .services.features import infer_granularity
from .services.forecast import generate_forecast


DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))

app = FastAPI(title="TalkToYourForecast API", version="0.1.0")

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
    Base.metadata.create_all(bind=engine)


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


@app.post("/api/uploads", response_model=UploadResponse)
async def upload_csv(file: UploadFile = File(...), db: Session = Depends(get_db)) -> UploadResponse:
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


@app.post("/api/forecast", response_model=ForecastResponse)
def forecast(request: ForecastRequest, db: Session = Depends(get_db)) -> ForecastResponse:
    upload = db.get(Upload, request.upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")

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
    return artifacts.response


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest, db: Session = Depends(get_db)) -> ChatResponse:
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    upload = db.get(Upload, request.upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")

    try:
        if not upload.last_forecast_path or not Path(upload.last_forecast_path).exists():
            artifacts = generate_forecast(upload, horizon_days=14, threshold=None)
            upload.last_forecast_path = artifacts.artifact_path
            upload.last_forecast_created_at = datetime.now(timezone.utc)
            db.add(upload)
            db.commit()

        response = answer_question(upload, request.question.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Chat failed: {exc}") from exc
    return response


@app.delete("/api/uploads/{upload_id}", response_model=DeleteUploadResponse)
def delete_upload(upload_id: str, db: Session = Depends(get_db)) -> DeleteUploadResponse:
    upload = db.get(Upload, upload_id)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found.")

    path = Path(upload.storage_path)
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)

    db.delete(upload)
    db.commit()
    return DeleteUploadResponse(ok=True)
