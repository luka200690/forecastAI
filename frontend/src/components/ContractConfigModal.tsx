import { useState } from "react";
import { saveContractConfig, type ContractConfig, type TouSlot } from "../api";

interface ContractConfigModalProps {
  uploadId: string;
  initialConfig: ContractConfig | null;
  onClose: () => void;
  onSave: (config: ContractConfig) => void;
  onError: (msg: string) => void;
}

function defaultConfig(uploadId: string): ContractConfig {
  return {
    upload_id: uploadId,
    contracted_capacity_kw: 500,
    soft_limit_kw: null,
    penalty_model: "alert_only",
    penalty_rate_eur_per_kw_period: null,
    risk_threshold_pct: 70,
    energy_price_source: "manual_flat",
    flat_price_eur_mwh: null,
    tou_schedule: [],
    max_shed_kw: 0,
    max_shift_hours: 4,
    protected_hours: [],
  };
}

export function ContractConfigModal({
  uploadId,
  initialConfig,
  onClose,
  onSave,
  onError,
}: ContractConfigModalProps) {
  const [draft, setDraft] = useState<ContractConfig>(
    initialConfig ?? defaultConfig(uploadId)
  );
  const [saving, setSaving] = useState(false);

  // Draft update helper
  const set = <K extends keyof ContractConfig>(key: K, val: ContractConfig[K]) =>
    setDraft((d) => ({ ...d, [key]: val }));

  // TOU schedule helpers
  const addTouSlot = () =>
    setDraft((d) => ({
      ...d,
      tou_schedule: [...d.tou_schedule, { dow: 0, h_from: 8, h_to: 18, eur_mwh: 100 }],
    }));

  const updateTouSlot = (i: number, field: keyof TouSlot, value: number) =>
    setDraft((d) => {
      const s = [...d.tou_schedule];
      s[i] = { ...s[i], [field]: value };
      return { ...d, tou_schedule: s };
    });

  const removeTouSlot = (i: number) =>
    setDraft((d) => ({
      ...d,
      tou_schedule: d.tou_schedule.filter((_, j) => j !== i),
    }));

  const handleSave = async () => {
    if (draft.contracted_capacity_kw <= 0) {
      onError("Contracted capacity must be greater than 0.");
      return;
    }
    if (draft.energy_price_source === "manual_flat" && !draft.flat_price_eur_mwh) {
      onError("Enter a flat price in €/MWh.");
      return;
    }
    if (draft.penalty_model === "expected_exceedance_cost" && !draft.penalty_rate_eur_per_kw_period) {
      onError("Enter a penalty rate €/kW-period.");
      return;
    }
    setSaving(true);
    try {
      const res = await saveContractConfig(uploadId, { ...draft, upload_id: uploadId });
      onSave(res.config!);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-box" style={{ maxWidth: 580, maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div className="modal-header">
          <span className="modal-icon">⚙</span>
          <h2 className="modal-title">Contract & Cost Settings</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* 1. Capacity */}
          <section>
            <div className="cr-section-header" style={{ padding: "8px 0", background: "none", border: "none", borderBottom: "1px solid var(--c-border)", marginBottom: 12 }}>
              Capacity Limits
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: 1, minWidth: 160 }}>
                <span className="modal-field-label">Contracted Capacity (kW) *</span>
                <input
                  type="number" min={0} step={1}
                  className="modal-input"
                  value={draft.contracted_capacity_kw}
                  onChange={(e) => set("contracted_capacity_kw", parseFloat(e.target.value) || 0)}
                />
              </label>
              <label style={{ flex: 1, minWidth: 160 }}>
                <span className="modal-field-label">Soft Limit (kW, optional)</span>
                <input
                  type="number" min={0} step={1}
                  className="modal-input"
                  value={draft.soft_limit_kw ?? ""}
                  placeholder="—"
                  onChange={(e) => set("soft_limit_kw", e.target.value ? parseFloat(e.target.value) : null)}
                />
              </label>
            </div>
          </section>

          {/* 2. Energy price */}
          <section>
            <div className="cr-section-header" style={{ padding: "8px 0", background: "none", border: "none", borderBottom: "1px solid var(--c-border)", marginBottom: 12 }}>
              Energy Price Source
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
              {(["manual_flat", "manual_tou"] as const).map((src) => (
                <label key={src} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.8rem", color: "var(--c-text)" }}>
                  <input
                    type="radio" name="price_source"
                    checked={draft.energy_price_source === src}
                    onChange={() => set("energy_price_source", src)}
                  />
                  {src === "manual_flat" ? "Flat rate (€/MWh)" : "Time-of-use bands"}
                </label>
              ))}
            </div>

            {draft.energy_price_source === "manual_flat" && (
              <label style={{ display: "block", maxWidth: 200 }}>
                <span className="modal-field-label">Flat Price (€/MWh) *</span>
                <input
                  type="number" min={0} step={0.01}
                  className="modal-input"
                  value={draft.flat_price_eur_mwh ?? ""}
                  placeholder="e.g. 120"
                  onChange={(e) => set("flat_price_eur_mwh", e.target.value ? parseFloat(e.target.value) : null)}
                />
              </label>
            )}

            {draft.energy_price_source === "manual_tou" && (
              <div>
                <div style={{ fontSize: "0.74rem", color: "var(--c-muted)", marginBottom: 8 }}>
                  Day · From · To · €/MWh
                </div>
                {draft.tou_schedule.map((slot, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <select
                      className="modal-input" style={{ flex: "0 0 70px" }}
                      value={slot.dow}
                      onChange={(e) => updateTouSlot(i, "dow", parseInt(e.target.value))}
                    >
                      {DOW_LABELS.map((d, idx) => <option key={idx} value={idx}>{d}</option>)}
                    </select>
                    <input type="number" min={0} max={23} className="modal-input" style={{ flex: "0 0 52px" }}
                      value={slot.h_from} onChange={(e) => updateTouSlot(i, "h_from", parseInt(e.target.value) || 0)} />
                    <span style={{ color: "var(--c-muted)", fontSize: "0.8rem" }}>–</span>
                    <input type="number" min={1} max={24} className="modal-input" style={{ flex: "0 0 52px" }}
                      value={slot.h_to} onChange={(e) => updateTouSlot(i, "h_to", parseInt(e.target.value) || 1)} />
                    <input type="number" min={0} step={0.01} className="modal-input" style={{ flex: 1 }}
                      value={slot.eur_mwh} placeholder="€/MWh"
                      onChange={(e) => updateTouSlot(i, "eur_mwh", parseFloat(e.target.value) || 0)} />
                    <button onClick={() => removeTouSlot(i)} style={{ background: "none", border: "none", color: "var(--c-red)", cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>✕</button>
                  </div>
                ))}
                <button
                  onClick={addTouSlot}
                  style={{ fontSize: "0.75rem", padding: "4px 10px", borderRadius: 5, border: "1px dashed var(--c-border)", background: "transparent", color: "var(--c-muted)", cursor: "pointer", marginTop: 4 }}
                >
                  + Add band
                </button>
              </div>
            )}
          </section>

          {/* 3. Penalty */}
          <section>
            <div className="cr-section-header" style={{ padding: "8px 0", background: "none", border: "none", borderBottom: "1px solid var(--c-border)", marginBottom: 12 }}>
              Penalty Model
            </div>
            <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
              {(["alert_only", "expected_exceedance_cost"] as const).map((m) => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.8rem", color: "var(--c-text)" }}>
                  <input
                    type="radio" name="penalty_model"
                    checked={draft.penalty_model === m}
                    onChange={() => set("penalty_model", m)}
                  />
                  {m === "alert_only" ? "Alert only (no €)" : "Expected exceedance cost"}
                </label>
              ))}
            </div>
            {draft.penalty_model === "expected_exceedance_cost" && (
              <label style={{ display: "block", maxWidth: 240 }}>
                <span className="modal-field-label">Penalty Rate (€/kW-month) *</span>
                <input
                  type="number" min={0} step={0.01}
                  className="modal-input"
                  value={draft.penalty_rate_eur_per_kw_period ?? ""}
                  placeholder="e.g. 15"
                  onChange={(e) => set("penalty_rate_eur_per_kw_period", e.target.value ? parseFloat(e.target.value) : null)}
                />
              </label>
            )}
          </section>

          {/* 4. Risk threshold */}
          <section>
            <div className="cr-section-header" style={{ padding: "8px 0", background: "none", border: "none", borderBottom: "1px solid var(--c-border)", marginBottom: 12 }}>
              Risk Threshold
            </div>
            <label style={{ display: "block", maxWidth: 200 }}>
              <span className="modal-field-label">Flag hour as "at-risk" when exceedance ≥ (%)</span>
              <input
                type="number" min={0} max={100} step={1}
                className="modal-input"
                value={draft.risk_threshold_pct}
                onChange={(e) => set("risk_threshold_pct", parseFloat(e.target.value) || 0)}
              />
            </label>
          </section>

          {/* 5. Flexibility */}
          <section>
            <div className="cr-section-header" style={{ padding: "8px 0", background: "none", border: "none", borderBottom: "1px solid var(--c-border)", marginBottom: 12 }}>
              Flexibility Assumptions
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label style={{ flex: 1, minWidth: 140 }}>
                <span className="modal-field-label">Max Shed (kW)</span>
                <input
                  type="number" min={0} step={1}
                  className="modal-input"
                  value={draft.max_shed_kw}
                  onChange={(e) => set("max_shed_kw", parseFloat(e.target.value) || 0)}
                />
              </label>
              <label style={{ flex: 1, minWidth: 140 }}>
                <span className="modal-field-label">Max Shift Window (±hours)</span>
                <input
                  type="number" min={0} max={24} step={1}
                  className="modal-input"
                  value={draft.max_shift_hours}
                  onChange={(e) => set("max_shift_hours", parseInt(e.target.value) || 0)}
                />
              </label>
              <label style={{ flex: "0 0 100%", maxWidth: 320 }}>
                <span className="modal-field-label">Protected Hours (comma-separated, e.g. 0,1,2)</span>
                <input
                  type="text"
                  className="modal-input"
                  value={draft.protected_hours.join(",")}
                  placeholder="e.g. 0,1,22,23"
                  onChange={(e) => {
                    const hrs = e.target.value
                      .split(",")
                      .map((s) => parseInt(s.trim()))
                      .filter((n) => !isNaN(n) && n >= 0 && n <= 23);
                    set("protected_hours", hrs);
                  }}
                />
              </label>
            </div>
          </section>

        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn-modal-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-run" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "⚙ Save Settings"}
          </button>
        </div>

      </div>
    </div>
  );
}
