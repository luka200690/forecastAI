"""
Recommendation service: greedy heuristic that identifies load-shed and
load-shift actions to reduce contract-capacity exceedance risk and energy cost.

Algorithm is fully deterministic and produces at most 20 recommendations.
"""
from __future__ import annotations

import uuid
from datetime import timedelta

from ..schemas import ContractConfig, HourlyEnrichedPoint, Recommendation
from .enrichment import compute_hour_exceedance


def generate_recommendations(
    enriched: list[HourlyEnrichedPoint],
    config: ContractConfig,
) -> list[Recommendation]:
    """
    Greedy action recommendations for risk hours.

    Pass 1: identify risk hours (exceedance_p >= threshold, not protected).
    Pass 2: for each risk hour, attempt SHED then SHIFT; emit the first
            viable action and move on to the next risk hour.

    Notes:
        - Shed: reduces P50 by up to max_shed_kw, re-computes exceedance.
        - Shift: moves 1 h of P50 load to the cheapest adjacent non-risk hour
          within ±max_shift_hours; risk_reduction = full exceedance_p (load gone).
        - Protected hours (config.protected_hours) are never shed or used as
          shift targets.
        - Returns at most 20 recommendations, sorted by
          (savings_eur + risk_reduction * 100) descending.
    """
    if not enriched:
        return []

    cap = config.contracted_capacity_kw
    threshold = config.risk_threshold_pct / 100.0
    protected = set(config.protected_hours)
    n = len(enriched)

    # Build risk-hour index list sorted by exceedance_p desc
    risk_indices = [
        i for i, h in enumerate(enriched)
        if h.exceedance_p >= threshold and h.ts.hour not in protected
    ]
    risk_indices.sort(key=lambda i: enriched[i].exceedance_p, reverse=True)

    recs: list[Recommendation] = []

    for idx in risk_indices:
        h = enriched[idx]

        # ── SHED ────────────────────────────────────────────────────────────
        if config.max_shed_kw > 0:
            delta_kw = min(config.max_shed_kw, h.p50_kw - cap)
            if delta_kw > 0:
                new_p50 = h.p50_kw - delta_kw
                new_exc, _ = compute_hour_exceedance(h.p10_kw, new_p50, h.p90_kw, cap)
                risk_reduction = h.exceedance_p - new_exc
                savings_eur = delta_kw * h.eur_mwh / 1000.0
                recs.append(
                    Recommendation(
                        id=str(uuid.uuid4()),
                        action_type="shed",
                        ts_from=h.ts,
                        ts_to=h.ts,
                        delta_kw=round(delta_kw, 2),
                        delta_kwh=round(delta_kw * 1.0, 2),
                        savings_eur=round(savings_eur, 4),
                        risk_reduction=round(risk_reduction, 4),
                        rationale=(
                            f"Reduce load by {delta_kw:.1f} kW at "
                            f"{h.ts.strftime('%Y-%m-%d %H:%M')} UTC to bring P50 "
                            f"from {h.p50_kw:.0f} to {new_p50:.0f} kW "
                            f"(capacity: {cap:.0f} kW)."
                        ),
                    )
                )
                continue  # handled this risk hour

        # ── SHIFT ───────────────────────────────────────────────────────────
        if config.max_shift_hours > 0:
            lo = max(0, idx - config.max_shift_hours)
            hi = min(n, idx + config.max_shift_hours + 1)
            candidates = [
                j for j in range(lo, hi)
                if j != idx and enriched[j].ts.hour not in protected
            ]
            if candidates:
                # Pick cheapest candidate hour
                target_idx = min(candidates, key=lambda j: enriched[j].cost_p50_eur)
                target = enriched[target_idx]
                if target.cost_p50_eur < h.cost_p50_eur:
                    delta_kwh = h.p50_kw * 1.0
                    savings_eur = (h.eur_mwh - target.eur_mwh) * delta_kwh / 1000.0
                    # Risk reduction: entire exceedance removed since load is shifted out
                    risk_reduction = h.exceedance_p
                    direction = "→" if target.ts > h.ts else "←"
                    recs.append(
                        Recommendation(
                            id=str(uuid.uuid4()),
                            action_type="shift",
                            ts_from=h.ts,
                            ts_to=target.ts,
                            delta_kw=round(h.p50_kw, 2),
                            delta_kwh=round(delta_kwh, 2),
                            savings_eur=round(savings_eur, 4),
                            risk_reduction=round(risk_reduction, 4),
                            rationale=(
                                f"Shift {h.p50_kw:.0f} kWh from "
                                f"{h.ts.strftime('%H:%M')} "
                                f"({h.eur_mwh:.1f} €/MWh) "
                                f"{direction} {target.ts.strftime('%H:%M')} "
                                f"({target.eur_mwh:.1f} €/MWh)."
                            ),
                        )
                    )

    # Sort by combined score and cap at 20
    recs.sort(key=lambda r: r.savings_eur + r.risk_reduction * 100, reverse=True)
    return recs[:20]
