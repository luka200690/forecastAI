from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

SYSTEM_PROMPT = """You are an expert at reading Italian and European industrial energy bills (electricity, gas, district heating).
Extract ALL of the following fields. Return ONLY valid JSON with exactly these keys:

Customer information (from the bill header/customer section):
- customer_name: string or null — company/person name on the bill
- customer_address: string or null — service/delivery address (street + number)
- customer_city: string or null — city of the service address
- customer_country: string or null — e.g. "Italy"
- customer_vat: string or null — VAT / P.IVA / fiscal code of the customer
- pod_code: string or null — POD = Punto di Consegna (electricity ID, e.g. IT001E123456789)
- pdi_code: string or null — PDI = Punto di Immissione (gas ID, e.g. IT003G123456789)
- meter_serial: string or null — meter serial/matricola number

Contract details:
- energy_type: "electricity" | "gas" | "district_heating" | "other"
- utility_company: string or null — energy supplier name
- contracted_capacity_kw: number or null — potenza impegnata/contrattuale in kW
- energy_price_eur_mwh: number or null — convert from €/kWh × 1000 if needed
- tariff_type: string or null — F1/F2/F3, monoraria, bioraria, spot, PUN, etc.
- billing_period: string or null — e.g. "January 2024"
- connection_voltage: string or null — BT/MT/AT + voltage level (electricity only)

Bill totals:
- total_energy_kwh: number or null — kWh for electricity, m³ for gas
- total_energy_unit: string or null — "kWh", "m³", "MWh", etc.
- total_bill_eur: number or null — total amount due (€)
- notes: string or null — penalties, reactive power charges, deposits, etc.
- confidence: "high" | "medium" | "low" — how complete and clear the bill was
"""


def analyze_energy_bill(file_content: bytes, filename: str) -> dict:
    from openai import OpenAI

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required.")
    model = os.getenv("BILL_ANALYSIS_MODEL", "gpt-4o")
    client = OpenAI(api_key=api_key)

    ext = Path(filename).suffix.lower()

    if ext == ".pdf":
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(file_content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        if len(text.strip()) > 100:
            # Enough text — use text-only (cheaper)
            input_messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Energy bill text:\n\n{text[:12000]}"},
            ]
        else:
            # Scanned PDF — send via vision
            b64 = base64.b64encode(file_content).decode()
            input_messages = _vision_messages(b64, "application/pdf")
    else:
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else f"image/{ext.lstrip('.')}"
        b64 = base64.b64encode(file_content).decode()
        input_messages = _vision_messages(b64, mime)

    completion = client.chat.completions.create(model=model, messages=input_messages)  # type: ignore[arg-type]
    raw = (completion.choices[0].message.content or "").strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        return json.loads(raw)
    except Exception:
        return {"notes": raw, "confidence": "low"}


def _vision_messages(b64: str, mime: str) -> list:
    return [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Extract contract details from this energy bill. " + SYSTEM_PROMPT,
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{b64}"},
                },
            ],
        }
    ]
