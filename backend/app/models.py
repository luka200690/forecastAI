from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    granularity: Mapped[str] = mapped_column(String, nullable=False)
    start_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rows: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    last_forecast_path: Mapped[str | None] = mapped_column(String, nullable=True)
    last_forecast_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    schedule_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="0")
    schedule_horizon_days: Mapped[int] = mapped_column(Integer, default=14, nullable=False, server_default="14")
    schedule_threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    schedule_frequency: Mapped[str] = mapped_column(String, default="daily", nullable=False, server_default="daily")


class ContractConfigModel(Base):
    __tablename__ = "contract_configs"

    upload_id: Mapped[str] = mapped_column(
        String, ForeignKey("uploads.id", ondelete="CASCADE"), primary_key=True
    )
    config_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    upload_id: Mapped[str] = mapped_column(
        String, ForeignKey("uploads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc)
    )
