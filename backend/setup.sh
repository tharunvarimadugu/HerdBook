#!/bin/bash

# Dairy Farm API - Development Setup Script
# This script sets up the development environment

set -e

echo "🐄 Dairy Farm Management System - Setup Script"
echo "=============================================="

# Check Python version
echo "✓ Checking Python version..."
python3 --version

# Create virtual environment if not exists
if [ ! -d "venv" ]; then
    echo "✓ Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "✓ Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "✓ Installing dependencies..."
pip install -r requirements.txt

# Create .env file if not exists
if [ ! -f ".env" ]; then
    echo "✓ Creating .env file..."
    cat > .env << EOF
FLASK_APP=run.py
FLASK_ENV=development
SECRET_KEY=dev-secret-key-change-in-production
JWT_SECRET_KEY=jwt-secret-key-change-in-production
DATABASE_URL=sqlite:///database/farm.db
EOF
    echo "  Note: Update .env file with your settings"
fi

# Create database directory
mkdir -p database
mkdir -p logs
mkdir -p uploads

# Initialize database
echo "✓ Initializing database..."
python3 << EOF
from app import create_app
from database.db import db
from datetime import datetime, date
from app.models import Cow, CowStatus, BreedType, Farm

app = create_app('development')

with app.app_context():
    print("  Creating tables...")
    db.create_all()
    
    # Check if data already exists
    if Cow.query.first() is None:
        print("  Seeding sample data...")
        
        # Create farm
        farm = Farm(
            name='Heritage Dairy Farm',
            location='Rural Village, Country',
            owner_name='John Smith',
            owner_email='john@farm.com',
            total_animals=25
        )
        db.session.add(farm)
        
        # Create sample cows
        cows_data = [
            {
                'name': 'Bessie-01',
                'ear_tag': 'TAG-1001',
                'breed': BreedType.HOLSTEIN,
                'birth_date': date(2020, 3, 15),
                'status': CowStatus.MILKING
            },
            {
                'name': 'Molly-02',
                'ear_tag': 'TAG-1002',
                'breed': BreedType.JERSEY,
                'birth_date': date(2021, 6, 10),
                'status': CowStatus.PREGNANT
            },
            {
                'name': 'Daisy-03',
                'ear_tag': 'TAG-1003',
                'breed': BreedType.HOLSTEIN,
                'birth_date': date(2019, 1, 20),
                'status': CowStatus.MILKING
            },
            {
                'name': 'Luna-04',
                'ear_tag': 'TAG-1004',
                'breed': BreedType.GUERNSEY,
                'birth_date': date(2021, 11, 5),
                'status': CowStatus.HEIFER
            },
            {
                'name': 'Rose-05',
                'ear_tag': 'TAG-1005',
                'breed': BreedType.JERSEY,
                'birth_date': date(2018, 8, 22),
                'status': CowStatus.DRY
            }
        ]
        
        for cow_data in cows_data:
            cow = Cow(**cow_data)
            db.session.add(cow)
        
        db.session.commit()
        print("  ✓ Sample data created")
    else:
        print("  Database already has data, skipping sample data")

print("✓ Database initialized")
EOF

echo ""
echo "=============================================="
echo "✅ Setup complete!"
echo ""
echo "To start the development server:"
echo "  source venv/bin/activate"
echo "  python run.py"
echo ""
echo "API will be available at: http://localhost:8000"
echo "API Endpoints:"
echo "  GET  http://localhost:8000/api/v1/herd/cows"
echo "  POST http://localhost:8000/api/v1/herd/cows"
echo "  GET  http://localhost:8000/api/v1/milk/records"
echo ""
echo "Happy farming! 🌾"
