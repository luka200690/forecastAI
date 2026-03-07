# TalkToYourForecast v0.2 (MVP)

TalkToYourForecast is a local MVP SaaS-style app where you:
- Upload energy consumption CSV data
- Generate a forecast with `P10/P50/P90`
- Compute threshold exceedance risk metrics
- Ask an LLM to explain forecast behavior using structured forecast outputs

## Stack
- Backend: Python 3.11, FastAPI, Uvicorn
- Data: pandas, numpy
- Models: quantile regression (`LightGBM -> CatBoost -> XGBoost -> sklearn fallback`)
- Storage: SQLite + SQLAlchemy
- Frontend: React + Vite + TypeScript
- Auth: Clerk (JWT validation via JWKS)
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
- `run_local.ps1`

---

## Environment Variables

### Backend (`backend/.env`)
- `AUTH_MODE` (`clerk` default, or `dev` for local bypass)
- `DEV_USER_ID` (used only when `AUTH_MODE=dev`, default `local-dev-user`)
- `OPENAI_API_KEY` (required for `/api/chat` and `/api/analysis`)
- `CLERK_JWKS_URL` (required when `AUTH_MODE=clerk`)
- `OPENAI_MODEL` (optional, default `gpt-4.1-mini`)
- `DATA_DIR` (optional, default `./data`)
- `CORS_ORIGINS` (optional, default `http://localhost:5173`)

### Frontend (`frontend/.env` or `frontend/.env.local`)
- `VITE_CLERK_PUBLISHABLE_KEY` (required)
- `VITE_API_BASE_URL` (optional, default `http://localhost:8000`)

Use `.env.example` as a reference template.

---

## Quickstart (Windows PowerShell)

### Option A — one command startup
```powershell
./run_local.ps1 \
  -AuthMode clerk \
  -ClerkPublishableKey "pk_test_..." \
  -ClerkJwksUrl "https://<your-clerk-domain>/.well-known/jwks.json" \
  -OpenAIApiKey "sk-..."
```

Local-dev shortcut (no Clerk JWT validation):
```powershell
./run_local.ps1 \
  -AuthMode dev \
  -DevUserId "local-dev-user" \
  -OpenAIApiKey "sk-..."
```

This will:
- create `.venv` if missing,
- install backend/frontend dependencies,
- start backend on `http://localhost:8010`,
- start frontend on `http://localhost:5173`.

Useful flags:
- `-Mode backend|frontend|all`
- `-AuthMode clerk|dev`
- `-DevUserId <id>`
- `-UseReload`
- `-SkipInstall`
- `-BackendPort 8000`
- `-FrontendPort 5173`

### Option B — manual startup

Backend:
```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

Frontend:
```powershell
cd frontend
npm install
npm run dev
```

---

## Authentication note (important)

`AUTH_MODE` controls API authentication:

- `AUTH_MODE=clerk` (default): most API endpoints require a valid `Authorization: Bearer <JWT>` token from Clerk.
- `AUTH_MODE=dev`: backend bypasses JWT validation and uses `DEV_USER_ID` for all requests (local development only).

If `AUTH_MODE=clerk` and `CLERK_JWKS_URL` is not configured, authenticated requests will fail.

Endpoints requiring auth include (non-exhaustive):
- `/api/uploads`
- `/api/forecast`
- `/api/chat`
- `/api/analysis`
- `/api/uploads/{id}/...`
- `/api/energy-bill/analyze`

---

## API Examples (authenticated)

Use a Clerk JWT token in `AUTH_TOKEN`.

### 1) Upload CSV
```bash
curl -X POST "http://localhost:8000/api/uploads" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -F "file=@sample_data/energy_sample.csv"
```

### 2) Forecast
```bash
curl -X POST "http://localhost:8000/api/forecast" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upload_id":"<UPLOAD_ID>","horizon_days":14,"threshold":140}'
```

### 3) Chat
```bash
curl -X POST "http://localhost:8000/api/chat" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upload_id":"<UPLOAD_ID>","question":"why is it higher on Tuesday?"}'
```

### 4) Delete Upload
```bash
curl -X DELETE "http://localhost:8000/api/uploads/<UPLOAD_ID>" \
  -H "Authorization: Bearer $AUTH_TOKEN"
```

---

## Happy Path Demo Flow
1. Start backend and frontend.
2. Sign in via Clerk in the frontend.
3. Upload `sample_data/energy_sample.csv`.
4. Click `Run Forecast` (e.g., 14 days).
5. Optionally set threshold and evaluate risk.
6. Ask chat questions, for example:
   - `why is it higher on Tuesday?`
   - `how reliable is this?`
   - `what's the peak risk tomorrow?`
7. Delete upload to remove local artifacts.

---

## Data Retention
- Uploaded and derived artifacts are stored locally under `DATA_DIR/<upload_id>`.
- This MVP is single-tenant and local-first by default.
- Use `DELETE /api/uploads/{upload_id}` to remove upload artifacts.

## Validation and Errors
- Missing required columns (`timestamp`, `value`) -> `400`
- Bad timestamps -> `400`
- Empty CSV or empty parsed data -> `400`
- Multiple `site_id` values -> `400` (single-series only for MVP)
- Missing upload id -> `404`
- Missing `OPENAI_API_KEY` for chat/analysis -> `503`

## Tests
Run backend unit tests:
```bash
pytest backend/tests -q
```

Includes:
- `backend/tests/test_risk.py` for empirical and fallback heuristic risk modes.

## Limitations and Next Steps
- Single-series only (no multi-site orchestration)
- No enterprise auth/billing workflows yet
- No production hardening yet (secrets mgmt, queueing, observability, retries)
- Forecasting approach is intentionally simple for MVP
