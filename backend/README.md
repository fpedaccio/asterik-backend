# FilterApps

AI image-filter PWA. Upload a photo, describe a filter style in natural language, get a filtered image back. Save filters privately or publish them to a public catalog.

## Stack

- **Backend** — FastAPI (Python 3.12+), Gemini API, Supabase service role
- **Frontend** — Next.js 16 (App Router) PWA, Tailwind v4, Supabase auth, TanStack Query
- **Data** — Supabase (Postgres + Storage + Auth)

## Two engines

Filters can be applied via two engines (switchable in the UI for A/B comparison):

- **Gemini direct** — sends the image to `gemini-2.5-flash-image` with a strict color-grading-only system instruction.
- **Hybrid LUT** — asks `gemini-2.5-flash` for structured grading parameters (`LutParams`), then applies them deterministically with Pillow + NumPy so the image content is preserved exactly.

## Layout

```
backend/           FastAPI service
frontend/          Next.js PWA
supabase/          SQL migrations + config
```

## Local setup

### 1. Supabase project

Create a project at https://supabase.com. Copy these into your env files:
- Project URL
- `anon` public key
- `service_role` key (backend only, NEVER ship to frontend)
- JWT secret (Project Settings → API → JWT Settings)

Run the migration in `supabase/migrations/0001_init.sql` via the SQL editor.

### 2. Backend

```bash
cd backend
cp .env.example .env   # fill in keys
uv sync
uv run uvicorn app.main:app --reload
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # fill in keys
npm install
npm run dev
```

### 4. PWA icons

Drop `icon-192.png` (192×192) and `icon-512.png` (512×512) into
`frontend/public/icons/`. The manifest and apple-touch-icon reference them.
Until these exist, install prompts will still work but show a placeholder.

## Engine comparison

The editor has a switch between **Gemini direct** and **Hybrid LUT**:

- *Gemini direct*: `gemini-2.5-flash-image` re-generates the image with a strict
  color-grade-only system instruction. Richer but may alter content.
- *Hybrid LUT*: `gemini-2.5-flash` returns structured `LutParams` JSON; the
  backend applies them deterministically via Pillow + NumPy. Preserves the
  image exactly; parameters are cached on the filter for zero-cost re-applies.

Each `generations` row stores `engine` and `elapsed_ms` for cost/latency
comparison. Expect Hybrid to be ~10× faster and ~100× cheaper per run.

## Environment

See `backend/.env.example` and `frontend/.env.example`.
