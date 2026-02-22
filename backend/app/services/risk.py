from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class RiskResult:
    threshold: float
    exceedance_probability: float
    expected_exceedance: float
    risk_score: float
    method: str
    explanation: str


def _safe_score(probability: float, expected_exceedance: float, threshold: float) -> float:
    normalized_severity = float(np.clip(expected_exceedance / max(threshold, 1e-6), 0.0, 1.0))
    return float(np.clip(100.0 * (0.7 * probability + 0.3 * normalized_severity), 0.0, 100.0))


def compute_risk(p50: np.ndarray, threshold: float, residuals: np.ndarray) -> RiskResult:
    p50 = np.asarray(p50, dtype=float)
    residuals = np.asarray(residuals, dtype=float)

    if residuals.size >= 20 and p50.size > 0:
        projected = p50[:, None] + residuals[None, :]
        exceed = projected > threshold
        exceedance_probability = float(exceed.mean())
        expected_exceedance = float(np.maximum(projected - threshold, 0.0).mean())
        risk_score = _safe_score(exceedance_probability, expected_exceedance, threshold)
        return RiskResult(
            threshold=threshold,
            exceedance_probability=exceedance_probability,
            expected_exceedance=expected_exceedance,
            risk_score=risk_score,
            method="empirical_residual",
            explanation="Computed from validation residual empirical distribution.",
        )

    median_p50 = float(np.median(p50)) if p50.size else 0.0
    q90_p50 = float(np.quantile(p50, 0.9)) if p50.size else 0.0
    if threshold <= median_p50:
        probability = 0.75
    elif threshold <= q90_p50:
        probability = 0.4
    else:
        probability = 0.12

    expected_exceedance = max(median_p50 - threshold, 0.0)
    risk_score = _safe_score(probability, expected_exceedance, threshold)
    return RiskResult(
        threshold=threshold,
        exceedance_probability=float(np.clip(probability, 0.0, 1.0)),
        expected_exceedance=float(expected_exceedance),
        risk_score=risk_score,
        method="heuristic",
        explanation="Insufficient validation residuals; fallback heuristic used.",
    )
