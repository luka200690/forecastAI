import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { analyzeEnergyBill, type EnergyBillAnalysis } from "../api";

// ── Types ─────────────────────────────────────────────────────────────────────

type SiteStatus = "active" | "maintenance" | "offline";

interface Company {
  name: string;
  address: string;
  city: string;
  country: string;
  vat_id: string;
  website: string;
  contact_email: string;
}

interface ProductionSite {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  floor_area_m2: number;
  peak_demand_kw: number;
  status: SiteStatus;
  commissioning_date: string;
  notes: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<SiteStatus, string> = {
  active:      "#4ADE80",
  maintenance: "#FBBF24",
  offline:     "#F87171",
};

const STATUS_LABEL: Record<SiteStatus, string> = {
  active:      "Active",
  maintenance: "Maintenance",
  offline:     "Offline",
};

const BLANK_SITE: Omit<ProductionSite, "id"> = {
  name: "", category: "", lat: 45.46, lon: 9.19,
  floor_area_m2: 0, peak_demand_kw: 0, status: "active", commissioning_date: "", notes: "",
};

const BLANK_COMPANY: Company = {
  name: "", address: "", city: "", country: "", vat_id: "", website: "", contact_email: "",
};

const LS_COMPANY = "forecastai_company";
const LS_SITES   = "forecastai_sites";
const LS_BILLS   = "forecastai_bills";

// ── Energy contracts types ────────────────────────────────────────────────────

interface StoredBill {
  id: string;
  filename: string;
  analyzed_at: string;
  analysis: EnergyBillAnalysis | null;
  error: string | null;
  plant_id?: string;
}

interface CompanyFill {
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  vat_id?: string;
}

const ENERGY_COLOR: Record<EnergyBillAnalysis["energy_type"], string> = {
  electricity:      "#60A5FA",
  gas:              "#FB923C",
  district_heating: "#F472B6",
  other:            "#94A3B8",
};

const ENERGY_EMOJI: Record<EnergyBillAnalysis["energy_type"], string> = {
  electricity:      "⚡",
  gas:              "🔥",
  district_heating: "♨️",
  other:            "📄",
};

// ── Leaflet helpers ───────────────────────────────────────────────────────────

function makeSiteIcon(status: SiteStatus) {
  const dot = STATUS_COLOR[status];
  return L.divIcon({
    className: "",
    html: `<div style="width:34px;height:34px;background:#60A5FA;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px rgba(0,0,0,0.45);border:2.5px solid rgba(0,0,0,0.18);position:relative;">
      <span>🏭</span>
      <span style="position:absolute;bottom:1px;right:1px;width:10px;height:10px;background:${dot};border-radius:50%;border:1.5px solid #111;"></span>
    </div>`,
    iconSize:    [34, 34],
    iconAnchor:  [17, 17],
    popupAnchor: [0, -20],
  });
}

function MapPicker({ picking, onPick }: { picking: boolean; onPick: (lat: number, lon: number) => void }) {
  const map = useMapEvents({
    click(e) {
      if (picking) onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  useEffect(() => {
    map.getContainer().style.cursor = picking ? "crosshair" : "";
  }, [picking, map]);
  return null;
}

// ── Site form modal ───────────────────────────────────────────────────────────

interface SiteFormProps {
  initial: Omit<ProductionSite, "id">;
  onSave: (s: Omit<ProductionSite, "id">) => void;
  onCancel: () => void;
  title: string;
}

function SiteForm({ initial, onSave, onCancel, title }: SiteFormProps) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: string | number) =>
    setForm((p) => ({ ...p, [k]: v }));

  const valid = form.name.trim() && form.lat !== 0 && form.lon !== 0;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-icon">🏭</span>
          <h2 className="modal-title">{title}</h2>
        </div>
        <div className="modal-body sites-form-grid">
          <label className="sites-field sites-field--wide">
            <span>Plant name</span>
            <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Milano Assembly Plant" />
          </label>
          <label className="sites-field">
            <span>Category</span>
            <input type="text" value={form.category} onChange={(e) => set("category", e.target.value)}
              placeholder="e.g. Assembly, Stamping, Paint Shop, Warehouse…" />
          </label>
          <label className="sites-field">
            <span>Status</span>
            <select value={form.status} onChange={(e) => set("status", e.target.value as SiteStatus)}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="offline">Offline</option>
            </select>
          </label>
          <label className="sites-field">
            <span>Floor Area (m²)</span>
            <input type="number" min={0} step={100} value={form.floor_area_m2}
              onChange={(e) => set("floor_area_m2", parseFloat(e.target.value) || 0)} />
          </label>
          <label className="sites-field" title="Maximum contracted or measured power demand — used by the Cost & Risk analysis">
            <span>Peak Demand (kW)</span>
            <input type="number" min={0} step={10} value={form.peak_demand_kw}
              onChange={(e) => set("peak_demand_kw", parseFloat(e.target.value) || 0)} />
          </label>
          <label className="sites-field">
            <span>Operational since</span>
            <input type="date" value={form.commissioning_date}
              onChange={(e) => set("commissioning_date", e.target.value)} />
          </label>
          <label className="sites-field">
            <span>Latitude</span>
            <input type="number" step={0.0001} value={form.lat}
              onChange={(e) => set("lat", parseFloat(e.target.value) || 0)} />
          </label>
          <label className="sites-field">
            <span>Longitude</span>
            <input type="number" step={0.0001} value={form.lon}
              onChange={(e) => set("lon", parseFloat(e.target.value) || 0)} />
          </label>
          <label className="sites-field sites-field--wide">
            <span>Notes</span>
            <input type="text" value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional — shift pattern, product line, owner, etc." />
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn btn-run" disabled={!valid} onClick={() => valid && onSave(form)}>
            Save plant
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Energy Contracts card ─────────────────────────────────────────────────────

const CONFIDENCE_COLOR: Record<EnergyBillAnalysis["confidence"], string> = {
  high:   "#4ADE80",
  medium: "#FBBF24",
  low:    "#F87171",
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <tr>
      <td style={{ color: "var(--fg-muted)", paddingRight: 14, whiteSpace: "nowrap", fontSize: "0.76rem", paddingBottom: 3, verticalAlign: "top" }}>{label}</td>
      <td style={{ fontFamily: "monospace", fontSize: "0.78rem", paddingBottom: 3 }}>{value}</td>
    </tr>
  );
}

function BillCard({ bill, onDelete, onFillCompany, sites }: {
  bill: StoredBill;
  onDelete: (id: string) => void;
  onFillCompany: (info: CompanyFill) => void;
  sites: ProductionSite[];
}) {
  const a = bill.analysis;
  const etype: EnergyBillAnalysis["energy_type"] = a?.energy_type ?? "other";
  const borderColor = a ? ENERGY_COLOR[etype] : "#4A5568";
  const conf = a?.confidence;
  const hasCustomerInfo = a && (a.customer_name || a.customer_address);
  const linkedPlant = bill.plant_id ? sites.find((s) => s.id === bill.plant_id) : null;

  return (
    <div style={{
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: "0 8px 8px 0",
      background: "rgba(255,255,255,0.04)",
      border: `1px solid rgba(255,255,255,0.08)`,
      borderLeftColor: borderColor,
      borderLeftWidth: 3,
      padding: "12px 14px",
      position: "relative",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: a ? 10 : 0 }}>
        <span style={{ fontSize: "1rem" }}>{a ? ENERGY_EMOJI[etype] : "📄"}</span>
        <span style={{ fontWeight: 600, fontSize: "0.84rem", flex: 1 }}>
          {a?.utility_company ?? bill.filename}
        </span>
        {linkedPlant && (
          <span style={{ fontSize: "0.71rem", background: "rgba(96,165,250,0.15)", color: "#60A5FA", border: "1px solid rgba(96,165,250,0.3)", borderRadius: 4, padding: "1px 7px", whiteSpace: "nowrap" }}>
            🏭 {linkedPlant.name}
          </span>
        )}
        {a?.billing_period && (
          <span style={{ fontSize: "0.73rem", color: "var(--fg-muted)" }}>{a.billing_period}</span>
        )}
        {!a && !bill.error && (
          <span style={{ fontSize: "0.73rem", color: "var(--fg-muted)" }}>⏳ Analysing…</span>
        )}
        {conf && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "0.71rem", fontWeight: 600, color: CONFIDENCE_COLOR[conf] }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: CONFIDENCE_COLOR[conf], display: "inline-block" }} />
            {conf.toUpperCase()}
          </span>
        )}
        <button
          onClick={() => onDelete(bill.id)}
          style={{ background: "none", border: "none", color: "var(--fg-muted)", cursor: "pointer", fontSize: "0.75rem", padding: "0 2px", lineHeight: 1 }}
          title="Remove"
        >✕</button>
      </div>

      {/* Error */}
      {bill.error && (
        <div style={{ fontSize: "0.75rem", color: "#F87171", fontStyle: "italic" }}>{bill.error}</div>
      )}

      {/* Details */}
      {a && (
        <>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <DetailRow label="Customer" value={a.customer_name} />
              <DetailRow label="Address"  value={[a.customer_address, a.customer_city].filter(Boolean).join(", ")} />
              <DetailRow label="VAT"      value={a.customer_vat} />
              <DetailRow label="POD"      value={a.pod_code} />
              <DetailRow label="PDI"      value={a.pdi_code} />
              <DetailRow label="Meter"    value={a.meter_serial} />
              <DetailRow label="Capacity" value={a.contracted_capacity_kw != null ? `${a.contracted_capacity_kw.toLocaleString()} kW` : null} />
              <DetailRow label="Price"    value={a.energy_price_eur_mwh != null ? `${a.energy_price_eur_mwh.toLocaleString()} €/MWh` : null} />
              <DetailRow label="Tariff"   value={a.tariff_type} />
              <DetailRow label="Connection" value={a.connection_voltage} />
              <DetailRow label="Energy"   value={a.total_energy_kwh != null ? `${a.total_energy_kwh.toLocaleString()} ${a.total_energy_unit ?? "kWh"}` : null} />
              <DetailRow label="Total"    value={a.total_bill_eur != null ? `€ ${a.total_bill_eur.toLocaleString()}` : null} />
            </tbody>
          </table>
          {a.notes && (
            <div style={{ marginTop: 6, fontSize: "0.74rem", color: "var(--fg-muted)", fontStyle: "italic" }}>{a.notes}</div>
          )}
          {hasCustomerInfo && (
            <button
              className="btn btn-panel-expand"
              style={{ marginTop: 10, fontSize: "0.74rem", padding: "3px 10px" }}
              onClick={() => onFillCompany({
                name:    a.customer_name    ?? undefined,
                address: a.customer_address ?? undefined,
                city:    a.customer_city    ?? undefined,
                country: a.customer_country ?? undefined,
                vat_id:  a.customer_vat     ?? undefined,
              })}
            >
              ↗ Fill Company Info
            </button>
          )}
        </>
      )}
    </div>
  );
}

function EnergyContractsCard({ onFillCompany, sites, onFindOrCreatePlant }: {
  onFillCompany: (info: CompanyFill) => void;
  sites: ProductionSite[];
  onFindOrCreatePlant: (analysis: EnergyBillAnalysis) => string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [bills, setBills] = useState<StoredBill[]>(() => {
    try { return JSON.parse(localStorage.getItem(LS_BILLS) ?? "[]") as StoredBill[]; }
    catch { return []; }
  });

  useEffect(() => { localStorage.setItem(LS_BILLS, JSON.stringify(bills)); }, [bills]);

  const handleFiles = (files: FileList) => {
    Array.from(files).forEach((file) => {
      const id = crypto.randomUUID();
      setBills((p) => [...p, { id, filename: file.name, analyzed_at: new Date().toISOString(), analysis: null, error: null }]);
      analyzeEnergyBill(file)
        .then((analysis) => {
          const plant_id = onFindOrCreatePlant(analysis);
          setBills((p) => p.map((b) => b.id === id ? { ...b, analysis, plant_id } : b));
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Analysis failed.";
          setBills((p) => p.map((b) => b.id === id ? { ...b, error: msg } : b));
        });
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = "";
  };

  const deleteBill = (id: string) => setBills((p) => p.filter((b) => b.id !== id));

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-icon">📄</span>
        <h2 className="card-title">Energy Contracts</h2>
        <button
          className="btn btn-run"
          style={{ marginLeft: "auto", padding: "4px 14px", fontSize: "0.75rem" }}
          onClick={() => fileRef.current?.click()}
        >
          ⬆ Add bill
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        multiple
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <p style={{ fontSize: "0.79rem", color: "var(--fg-muted)", marginBottom: bills.length ? 14 : 0 }}>
        Upload electricity, gas, or other energy bills — the AI extracts contract details and company info automatically.
      </p>
      {bills.length === 0 ? (
        <div className="chart-placeholder" style={{ height: 72, marginTop: 12 }}>
          <span className="chart-placeholder-icon">📄</span>
          <span className="chart-placeholder-text">No bills uploaded yet — click "Add bill" to get started.</span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {bills.map((b) => (
            <BillCard key={b.id} bill={b} onDelete={deleteBill} onFillCompany={onFillCompany} sites={sites} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SitesPage() {
  // Company
  const [company, setCompany] = useState<Company>(() => {
    try { return JSON.parse(localStorage.getItem(LS_COMPANY) ?? "") as Company; }
    catch { return { ...BLANK_COMPANY }; }
  });
  const [companySaved, setCompanySaved] = useState(false);

  // Sites
  const [sites, setSites] = useState<ProductionSite[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_SITES) ?? "[]") as ProductionSite[];
      // Migrate old sites that had `type` instead of `category`
      return raw.map((s: any) => ({
        ...s,
        category: s.category ?? s.type ?? "",
      }));
    }
    catch { return []; }
  });

  // Form / modal
  const [addOpen,  setAddOpen]  = useState(false);
  const [editSite, setEditSite] = useState<ProductionSite | null>(null);
  const [picking,  setPicking]  = useState(false);

  // Persist
  useEffect(() => { localStorage.setItem(LS_COMPANY, JSON.stringify(company)); }, [company]);
  useEffect(() => { localStorage.setItem(LS_SITES,   JSON.stringify(sites));   }, [sites]);

  const setComp = (k: keyof Company, v: string) =>
    setCompany((p) => ({ ...p, [k]: v }));

  const handleSaveCompany = () => {
    setCompanySaved(true);
    setTimeout(() => setCompanySaved(false), 2000);
  };

  const handleAddSite = (s: Omit<ProductionSite, "id">) => {
    setSites((p) => [...p, { ...s, id: crypto.randomUUID() }]);
    setAddOpen(false);
  };

  const handleEditSite = (s: Omit<ProductionSite, "id">) => {
    if (!editSite) return;
    setSites((p) => p.map((x) => x.id === editSite.id ? { ...s, id: editSite.id } : x));
    setEditSite(null);
  };

  const handleDelete = (id: string) =>
    setSites((p) => p.filter((s) => s.id !== id));

  const findOrCreatePlant = (analysis: EnergyBillAnalysis): string => {
    const name = (analysis.customer_name ?? "").trim();
    if (name) {
      const existing = sites.find((s) => s.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing.id;
    }
    const newPlant: ProductionSite = {
      id: crypto.randomUUID(),
      name: name || analysis.customer_address || "Unknown Plant",
      category: "",
      lat: 45.46, lon: 9.19,
      floor_area_m2: 0,
      peak_demand_kw: analysis.contracted_capacity_kw ?? 0,
      status: "active",
      commissioning_date: "",
      notes: [analysis.customer_address, analysis.customer_city].filter(Boolean).join(", "),
    };
    setSites((p) => [...p, newPlant]);
    return newPlant.id;
  };

  const mapCenter: [number, number] = sites.length
    ? [sites.reduce((a, s) => a + s.lat, 0) / sites.length, sites.reduce((a, s) => a + s.lon, 0) / sites.length]
    : [45.46, 9.19];

  const totalPeakKw = sites.reduce((a, s) => a + (s.peak_demand_kw ?? 0), 0);
  const activeSites = sites.filter((s) => s.status === "active").length;

  return (
    <div className="sites-page">

      {/* ── Company info card ── */}
      <div className="card sites-company-card">
        <div className="card-header">
          <span className="card-icon">🏢</span>
          <h2 className="card-title">Company Information</h2>
          <button className="btn btn-run" style={{ marginLeft: "auto", padding: "4px 14px", fontSize: "0.75rem" }}
            onClick={handleSaveCompany}>
            {companySaved ? "✓ Saved" : "Save"}
          </button>
        </div>
        <div className="sites-form-grid" style={{ padding: "4px 0" }}>
          <label className="sites-field sites-field--wide">
            <span>Company name</span>
            <input type="text" value={company.name} onChange={(e) => setComp("name", e.target.value)} placeholder="e.g. Acme Manufacturing S.p.A." />
          </label>
          <label className="sites-field sites-field--wide">
            <span>Address</span>
            <input type="text" value={company.address} onChange={(e) => setComp("address", e.target.value)} placeholder="Via Roma 1" />
          </label>
          <label className="sites-field">
            <span>City</span>
            <input type="text" value={company.city} onChange={(e) => setComp("city", e.target.value)} placeholder="Milano" />
          </label>
          <label className="sites-field">
            <span>Country</span>
            <input type="text" value={company.country} onChange={(e) => setComp("country", e.target.value)} placeholder="Italy" />
          </label>
          <label className="sites-field">
            <span>VAT / P.IVA</span>
            <input type="text" value={company.vat_id} onChange={(e) => setComp("vat_id", e.target.value)} placeholder="IT12345678901" />
          </label>
          <label className="sites-field">
            <span>Contact email</span>
            <input type="email" value={company.contact_email} onChange={(e) => setComp("contact_email", e.target.value)} placeholder="info@company.com" />
          </label>
          <label className="sites-field sites-field--wide">
            <span>Website</span>
            <input type="text" value={company.website} onChange={(e) => setComp("website", e.target.value)} placeholder="https://company.com" />
          </label>
        </div>
      </div>

      {/* ── Energy Contracts card ── */}
      <EnergyContractsCard
        onFillCompany={(info) => {
          if (info.name)    setComp("name",    info.name);
          if (info.address) setComp("address", info.address);
          if (info.city)    setComp("city",    info.city);
          if (info.country) setComp("country", info.country);
          if (info.vat_id)  setComp("vat_id",  info.vat_id);
        }}
        sites={sites}
        onFindOrCreatePlant={findOrCreatePlant}
      />

      {/* ── Plants table card ── */}
      <div className="card">
        <div className="card-header">
          <span className="card-icon">🏭</span>
          <h2 className="card-title">Manufacturing Plants</h2>
          {sites.length > 0 && (
            <div style={{ display: "flex", gap: 10, marginLeft: 12, alignItems: "center" }}>
              <span className="info-badge cyan">{sites.length} plant{sites.length !== 1 ? "s" : ""}</span>
              <span className="info-badge green">{totalPeakKw.toLocaleString()} kW peak</span>
              <span className="info-badge cyan">{activeSites} active</span>
            </div>
          )}
          <button className="btn btn-run" style={{ marginLeft: "auto", padding: "4px 14px", fontSize: "0.75rem" }}
            onClick={() => setAddOpen(true)}>
            + Add plant
          </button>
        </div>

        {sites.length === 0 ? (
          <div className="chart-placeholder" style={{ height: 100 }}>
            <span className="chart-placeholder-icon">🏭</span>
            <span className="chart-placeholder-text">No plants registered yet. Click "Add plant" to register your first facility.</span>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="sites-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Area (m²)</th>
                  <th>Peak (kW)</th>
                  <th>Status</th>
                  <th>Since</th>
                  <th>Coordinates</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sites.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name}</td>
                    <td style={{ color: "var(--fg-muted)", fontSize: "0.8rem" }}>{s.category || "—"}</td>
                    <td style={{ fontFamily: "monospace" }}>{(s.floor_area_m2 ?? 0).toLocaleString()}</td>
                    <td style={{ fontFamily: "monospace" }}>{(s.peak_demand_kw ?? 0).toLocaleString()}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[s.status], display: "inline-block", flexShrink: 0 }} />
                        <span style={{ color: STATUS_COLOR[s.status], fontSize: "0.75rem" }}>{STATUS_LABEL[s.status]}</span>
                      </span>
                    </td>
                    <td style={{ color: "var(--fg-muted)", fontFamily: "monospace", fontSize: "0.75rem" }}>
                      {s.commissioning_date || "—"}
                    </td>
                    <td style={{ color: "var(--fg-muted)", fontFamily: "monospace", fontSize: "0.72rem" }}>
                      {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="sites-row-btn" onClick={() => setEditSite(s)} title="Edit">✏</button>
                        <button className="sites-row-btn sites-row-btn--del" onClick={() => handleDelete(s.id)} title="Delete">✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Map card ── */}
      <div className="card sites-map-card">
        <div className="card-header">
          <span className="card-icon">🗺</span>
          <h2 className="card-title">Plant Map</h2>
          {sites.length > 0 && (
            <button
              className="btn-panel-expand"
              style={{ marginLeft: "auto" }}
              onClick={() => setPicking((p) => !p)}
              title="Click on the map to copy coordinates"
            >
              {picking ? "✓ Picking…" : "📍 Pick coords"}
            </button>
          )}
        </div>
        <div className="sites-map-container">
          <MapContainer
            center={mapCenter}
            zoom={sites.length ? 7 : 6}
            style={{ height: "100%", width: "100%", borderRadius: 6 }}
            key={`map-${mapCenter[0].toFixed(2)}-${mapCenter[1].toFixed(2)}`}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
            />
            <MapPicker picking={picking} onPick={(lat, lon) => {
              navigator.clipboard?.writeText(`${lat.toFixed(6)}, ${lon.toFixed(6)}`);
            }} />
            {sites.map((s) => (
              <Marker key={s.id} position={[s.lat, s.lon]} icon={makeSiteIcon(s.status)}>
                <Popup>
                  <div style={{ fontFamily: "monospace", fontSize: "0.8rem", minWidth: 190 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, fontSize: "0.88rem" }}>{s.name}</div>
                    {s.category && <div style={{ color: "#60A5FA", marginBottom: 2 }}>🏭 {s.category}</div>}
                    <div style={{ marginTop: 4 }}>📐 <strong>{(s.floor_area_m2 ?? 0).toLocaleString()} m²</strong> &nbsp;·&nbsp; ⚡ <strong>{(s.peak_demand_kw ?? 0).toLocaleString()} kW peak</strong></div>
                    <div style={{ marginTop: 2, color: STATUS_COLOR[s.status] }}>● {STATUS_LABEL[s.status]}</div>
                    {s.commissioning_date && <div style={{ marginTop: 2, color: "#888" }}>📅 {s.commissioning_date}</div>}
                    {s.notes && <div style={{ marginTop: 4, color: "#aaa", fontStyle: "italic", fontSize: "0.72rem" }}>{s.notes}</div>}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
          {sites.length === 0 && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.35)", borderRadius: 6, color: "rgba(255,255,255,0.5)",
              fontSize: "0.8rem", pointerEvents: "none", zIndex: 500,
            }}>
              Add plants to see them on the map
            </div>
          )}
        </div>
        {picking && (
          <div style={{ marginTop: 8, fontSize: "0.72rem", color: "var(--fg-muted)", textAlign: "center" }}>
            Click anywhere on the map — coordinates will be copied to clipboard
          </div>
        )}
      </div>

      {/* ── Add modal ── */}
      {addOpen && (
        <SiteForm title="Add Manufacturing Plant" initial={{ ...BLANK_SITE }}
          onSave={handleAddSite} onCancel={() => setAddOpen(false)} />
      )}

      {/* ── Edit modal ── */}
      {editSite && (
        <SiteForm title="Edit Plant" initial={{ ...editSite }}
          onSave={handleEditSite} onCancel={() => setEditSite(null)} />
      )}
    </div>
  );
}
