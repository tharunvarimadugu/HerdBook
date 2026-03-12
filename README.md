# Dairy Farm Lifecycle Management System

A self-hostable dairy herd management app built for personal farm operations. It combines a Flask backend with a lightweight browser frontend for herd tracking, lactation-aware milk records, health monitoring, reproduction workflows, feed logs, and JSON/CSV import-export.

## Project Layout

- `backend/`: Flask API, data models, deployment scripts
- `frontend/`: Static HTML/CSS/JS client served by the backend

## Quick Start

1. `cd backend`
2. `python3 -m venv venv`
3. `source venv/bin/activate`
4. `pip install -r requirements.txt`
5. `cp .env.example .env`
6. `python run.py`
7. Open `http://<your-raspberry-pi-ip>:8000/`
## shell script run it under one command 
backed 
./start-production.sh


## Raspberry Pi Notes

- The default backend port is `8000`.
- SQLite is the simplest default for personal use.
- For a long-running service, use `backend/start-production.sh`.

## Testing

```bash
cd backend
python3 -m unittest discover -s tests
```
