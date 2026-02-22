# TalkToYourForecast v0.1 (MVP)

TalkToYourForecast is a local MVP SaaS-style app where you:
- Upload energy consumption CSV data
- Generate a forecast with `P10/P50/P90`
- Compute threshold exceedance risk metrics
- Ask an LLM to explain forecast behavior using only structured outputs (never raw CSV rows)

## Stack
- Backend: Python 3.11, FastAPI, Uvicorn
- Data: pandas, numpy
- Models: quantile regression (`LightGBM -> CatBoost -> XGBoost -> sklearn fallback`)
- Storage: SQLite + SQLAlchemy
- Frontend: React + Vite + TypeScript
- Charting: Recharts
- Chat: OpenAI API (`OPENAI_API_KEY`)

## Project Structure
- `backend/app/main.py`
- `backend/app/services/features.py`
- `backend/app/services/forecast.py`
- `backend/app/services/risk.py`
- `backend/app/services/chat.py`
- `backend/app/db.py`
- `backend/app/models.py`
- `backend/app/schemas.py`
- `backend/requirements.txt`
- `backend/tests/test_risk.py`
- `frontend/`
- `sample_data/energy_sample.csv`

## Environment Variables
- `OPENAI_API_KEY` (required for `/api/chat`)
- `OPENAI_MODEL` (optional, default `gpt-4.1-mini`)
- `DATA_DIR` (optional, default `./data`)
- `CORS_ORIGINS` (optional, default `http://localhost:5173`)

## Backend Setup
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
```

Backend runs on `http://localhost:8000`.

## Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

Optional frontend API base override:
```bash
set VITE_API_BASE_URL=http://localhost:8000
```

## API Examples (curl)

### 1) Upload CSV
```bash
curl -X POST "http://localhost:8000/api/uploads" ^
  -F "file=@sample_data/energy_sample.csv"
```

### 2) Forecast
```bash
curl -X POST "http://localhost:8000/api/forecast" ^
  -H "Content-Type: application/json" ^
  -d "{\"upload_id\":\"<UPLOAD_ID>\",\"horizon_days\":14,\"threshold\":140}"
```

### 3) Chat
```bash
curl -X POST "http://localhost:8000/api/chat" ^
  -H "Content-Type: application/json" ^
  -d "{\"upload_id\":\"<UPLOAD_ID>\",\"question\":\"why is it higher on Tuesday?\"}"
```

### 4) Delete Upload
```bash
curl -X DELETE "http://localhost:8000/api/uploads/<UPLOAD_ID>"
```

## Happy Path Demo Flow
1. Start backend and frontend.
2. Upload `sample_data/energy_sample.csv`.
3. Click `Generate Forecast` with 14 days selected.
4. In risk panel, set a threshold and compute risk.
5. Ask chat questions like:
   - `why is it higher on Tuesday?`
   - `how reliable is this?`
   - `what's the peak risk tomorrow?`
6. Delete the upload to remove local artifacts.

## Data Retention Note
- Uploaded and derived artifacts are stored locally under `DATA_DIR/<upload_id>`.
- This MVP is single-tenant and local-only by default.
- Use `DELETE /api/uploads/{upload_id}` to remove an upload and its artifacts.

## Validation and Errors
- Missing required columns (`timestamp`, `value`) -> `400`
- Bad timestamps -> `400`
- Empty CSV or empty parsed data -> `400`
- Multiple `site_id` values -> `400` (single-series only for MVP)
- Missing upload id -> `404`
- Missing `OPENAI_API_KEY` for chat -> `503`

## Tests
Run backend unit tests:
```bash
pytest backend/tests -q
```

Includes:
- `backend/tests/test_risk.py` for empirical and fallback heuristic risk modes.

## Limitations and Next Steps
- Single-series only (no multi-site orchestration)
- No enterprise auth/billing
- No SCADA integrations
- No production hardening (secrets mgmt, queueing, observability, retries)
- Forecasting approach is intentionally simple for MVP

## GitHub Private Upload Checklist
1. Keep `.env` local only; do not commit secrets.
2. Confirm `.gitignore` is present at repo root (already added).
3. Initialize git and make first commit:
```bash
git init
git add .
git commit -m "Initial MVP: TalkToYourForecast v0.1"
```
4. Create a private GitHub repo, then push:
```bash
git branch -M main
git remote add origin https://github.com/<your-user>/<your-private-repo>.git
git push -u origin main
```
