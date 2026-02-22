import numpy as np

from backend.app.services.risk import compute_risk


def test_empirical_risk_method() -> None:
    p50 = np.array([100.0, 110.0, 120.0])
    residuals = np.linspace(-20.0, 20.0, 50)
    result = compute_risk(p50=p50, threshold=115.0, residuals=residuals)
    assert result.method == "empirical_residual"
    assert 0.0 <= result.exceedance_probability <= 1.0
    assert result.expected_exceedance >= 0.0
    assert 0.0 <= result.risk_score <= 100.0


def test_heuristic_fallback_when_residuals_small() -> None:
    p50 = np.array([80.0, 90.0, 95.0])
    residuals = np.array([1.0, -2.0, 0.5])
    result = compute_risk(p50=p50, threshold=120.0, residuals=residuals)
    assert result.method == "heuristic"
    assert 0.0 <= result.exceedance_probability <= 1.0
