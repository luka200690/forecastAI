"""Fetch weather forecast from Open-Meteo (free, no API key required)."""
from __future__ import annotations

import os
from datetime import date, datetime, timezone

import requests

from ..schemas import WeatherPoint

WEATHER_LAT = float(os.environ.get("WEATHER_LAT", "45.46"))   # default: Milan
WEATHER_LON = float(os.environ.get("WEATHER_LON", "9.19"))

# Open-Meteo endpoints
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def get_weather_forecast(start_date: str, end_date: str, granularity: str) -> list[WeatherPoint]:
    """Return weather points aligned to the forecast granularity.

    Automatically selects the forecast or archive Open-Meteo endpoint
    depending on whether the requested dates are in the future or the past.

    Args:
        start_date: YYYY-MM-DD string (first forecast date).
        end_date:   YYYY-MM-DD string (last forecast date).
        granularity: "hourly" or "daily".

    Returns:
        List of WeatherPoint, or [] if the request fails.
    """
    today = datetime.now(timezone.utc).date()
    start = _parse_date(start_date)

    # Use archive API for past dates, forecast API for future/current dates.
    # The forecast API covers roughly today ± 16 days; for anything older use the archive.
    url = _FORECAST_URL if start >= today else _ARCHIVE_URL

    try:
        if granularity == "hourly":
            resp = requests.get(
                url,
                params={
                    "latitude":   WEATHER_LAT,
                    "longitude":  WEATHER_LON,
                    "hourly":     "temperature_2m",
                    "start_date": start_date,
                    "end_date":   end_date,
                    "timezone":   "UTC",
                },
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            times: list[str]         = data["hourly"]["time"]
            temps: list[float | None] = data["hourly"]["temperature_2m"]
            return [
                WeatherPoint(ts=t + ":00Z", temperature_c=v)
                for t, v in zip(times, temps)
                if v is not None
            ]

        else:  # daily
            resp = requests.get(
                url,
                params={
                    "latitude":   WEATHER_LAT,
                    "longitude":  WEATHER_LON,
                    "daily":      "temperature_2m_mean",
                    "start_date": start_date,
                    "end_date":   end_date,
                    "timezone":   "UTC",
                },
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            times = data["daily"]["time"]
            temps = data["daily"]["temperature_2m_mean"]
            return [
                WeatherPoint(ts=t + "T00:00:00Z", temperature_c=v)
                for t, v in zip(times, temps)
                if v is not None
            ]

    except Exception as exc:
        # Weather is optional — log and return empty so forecast still works
        print(f"[weather] Failed to fetch from {url}: {exc}")
        return []
