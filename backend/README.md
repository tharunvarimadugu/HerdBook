# Backend

Flask API for the Dairy Farm Lifecycle Management System.

## Features

- herd management
- lactation-aware milk records
- health tracking
- reproduction workflows and alerts
- feed records
- photo upload support
- Google Drive backups for one self-hosted server account

## Run Locally

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python run.py
```

The API and frontend are served from `http://localhost:8000/`.

## Test

```bash
cd backend
python3 -m unittest discover -s tests
```

## Notes

- Default development database: `sqlite:///backend/database/farm.db`
- Production can override with `DATABASE_URL`
- Runtime data such as DB files, logs, and uploads should stay out of git
- To enable Google Drive backups, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `backend/.env`
