"""
WSGI entry point for production deployment
Use with Gunicorn: gunicorn -c gunicorn.conf.py wsgi:app
"""

import os
from app import create_app, db

# Get configuration from environment
config_name = os.environ.get('FLASK_ENV', 'production')

# Create app
app = create_app(config_name)

# Initialize database
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000)
