"""
Database initialization and lightweight schema maintenance.
"""

import os

from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()
migrate = Migrate()


def init_db(app):
    """Initialize database with Flask app."""
    db.init_app(app)
    migrate.init_app(app, db)

    db_path = app.config['SQLALCHEMY_DATABASE_URI']
    if db_path.startswith('sqlite://'):
        db_dir = os.path.dirname(db_path.replace('sqlite:///', ''))
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir)

    with app.app_context():
        # Ensure SQLAlchemy has registered all models before create_all().
        import app.models  # noqa: F401

        db.create_all()
        ensure_sqlite_schema()
        sync_lactation_history()

    return db


def ensure_sqlite_schema():
    """Add newly introduced columns for existing SQLite databases."""
    engine = db.engine
    if engine.dialect.name != 'sqlite':
        return

    column_specs = {
        'cows': {
            'current_lactation_number': 'INTEGER NOT NULL DEFAULT 0',
            'current_lactation_start_date': 'DATE'
        },
        'milk_records': {
            'lactation_number': 'INTEGER NOT NULL DEFAULT 0'
        },
        'health_records': {
            'lactation_number': 'INTEGER NOT NULL DEFAULT 0'
        },
        'reproduction_events': {
            'lactation_number': 'INTEGER NOT NULL DEFAULT 0'
        }
    }

    with engine.begin() as connection:
        for table_name, specs in column_specs.items():
            table_info = connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
            if not table_info:
                continue
            existing_columns = {row[1] for row in table_info}
            for column_name, sql_type in specs.items():
                if column_name in existing_columns:
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {sql_type}"
                )


def sync_lactation_history():
    """Backfill lactation fields for existing records."""
    from app.models import Cow, CowStatus, HealthRecord, MilkRecord, ReproductionEvent

    cows = Cow.query.all()
    for cow in cows:
        calvings = ReproductionEvent.query.filter_by(
            cow_id=cow.id,
            event_type='calving'
        ).order_by(ReproductionEvent.event_date.asc()).all()

        calving_index = {event.id: idx + 1 for idx, event in enumerate(calvings)}
        current_lactation = len(calvings)
        if current_lactation == 0 and cow.status in (CowStatus.MILKING, CowStatus.PREGNANT, CowStatus.DRY):
            current_lactation = max(cow.current_lactation_number or 0, 1)

        cow.current_lactation_number = max(cow.current_lactation_number or 0, current_lactation)
        cow.current_lactation_start_date = calvings[-1].event_date if calvings else cow.current_lactation_start_date

        def lactation_for_date(target_date):
            count = sum(1 for event in calvings if event.event_date <= target_date)
            if count > 0:
                return count
            return 1 if cow.status in (CowStatus.MILKING, CowStatus.PREGNANT, CowStatus.DRY) else 0

        for record in MilkRecord.query.filter_by(cow_id=cow.id).all():
            if not record.lactation_number:
                record.lactation_number = lactation_for_date(record.record_date)

        for record in HealthRecord.query.filter_by(cow_id=cow.id).all():
            if not record.lactation_number:
                record.lactation_number = lactation_for_date(record.issue_date)

        for event in ReproductionEvent.query.filter_by(cow_id=cow.id).all():
            if event.lactation_number:
                continue
            if event.event_type == 'calving':
                event.lactation_number = calving_index.get(event.id, lactation_for_date(event.event_date))
            else:
                event.lactation_number = lactation_for_date(event.event_date)

    db.session.commit()
