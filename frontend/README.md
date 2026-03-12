# Frontend

Static HTML/CSS/JavaScript client for the dairy farm dashboard.

## Highlights

- herd dashboard
- lactation-grouped record views
- JSON/CSV export
- JSON/CSV import visualization
- cow detail modal

## Run

Run the backend and open the app through it:

```bash
cd backend
python run.py
```

Then visit `http://localhost:8000/`.

## Structure

- `index.html`: app shell
- `css/`: styling split by concern
- `js/config.js`: runtime config
- `js/data.js`: state and normalizers
- `js/api.js`: backend API calls
- `js/ui.js`: UI utilities
- `js/app.js`: main app logic
