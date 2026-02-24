from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..db import SessionLocal
from ..models import Upload
from .forecast import generate_forecast

logger = logging.getLogger(__name__)


def run_scheduled_forecasts() -> None:
    """Daily job: re-run forecast for every upload that has schedule_enabled=True."""
    db = SessionLocal()
    try:
        uploads = db.query(Upload).filter(Upload.schedule_enabled.is_(True)).all()
        if not uploads:
            logger.info("Scheduled forecasts: no enabled schedules found.")
            return

        logger.info("Scheduled forecasts: running for %d upload(s).", len(uploads))
        for upload in uploads:
            try:
                artifacts = generate_forecast(
                    upload,
                    horizon_days=upload.schedule_horizon_days or 14,
                    threshold=upload.schedule_threshold,
                )
                upload.last_forecast_path = artifacts.artifact_path
                upload.last_forecast_created_at = datetime.now(timezone.utc)
                db.add(upload)
                db.commit()
                logger.info("Scheduled forecast complete: upload_id=%s", upload.id)
            except Exception as exc:
                db.rollback()
                logger.error("Scheduled forecast failed: upload_id=%s error=%s", upload.id, exc)
    finally:
        db.close()
