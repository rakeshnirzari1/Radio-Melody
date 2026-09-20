# Radio Melody

Radio Melody has:
- `frontend/` (React app)
- `backend/` (FastAPI API used by the frontend)

## Run locally

Frontend:
```bash
cd frontend
yarn install
yarn start
```

Backend:
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Set `REACT_APP_BACKEND_URL` for the frontend (example: `http://localhost:8000`).

## GitHub Pages deployment (frontend)

This repository includes `.github/workflows/deploy-frontend-pages.yml` to deploy the React frontend to GitHub Pages.

### One-time setup

1. In GitHub repo settings, create an Actions secret:
   - `REACT_APP_BACKEND_URL` = your deployed backend HTTPS URL
2. (Optional) Create repository variable `PAGES_BASE_PATH` if you need a custom base path.
   - Example: `/radio` (leave unset for default behavior)
3. In **Settings → Pages**, set source to **GitHub Actions**.
4. Push to `main` (or run the workflow manually) to deploy.

The workflow builds from `frontend/` and publishes `frontend/build`.

## Backend hosting requirement

GitHub Pages is static hosting only.  
You must deploy `backend/` separately (Render, Railway, Fly.io, etc.) and point `REACT_APP_BACKEND_URL` to that backend.

## Custom domain later

When ready to move from `*.github.io` to your `.com`:
1. Add your domain in **Settings → Pages**.
2. Configure DNS records at your domain provider.
3. Add/update `CNAME` if required by your Pages setup.
