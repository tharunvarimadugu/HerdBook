"""
Backup export and restore helpers.
"""

import json
from datetime import datetime

from app.models import Alert, Cow, Farm, FeedRecord, HealthRecord, MilkRecord, ReproductionEvent
from database.db import db


class BackupValidationError(ValueError):
    """Raised when a backup payload is invalid."""


class BackupService:
    """Build and restore JSON snapshots for the app database."""

    VERSION = '2.1.0'
    SOURCE = 'dairy-farm-lifecycle-management'

    @classmethod
    def export_payload(cls):
        return {
            'exported_at': datetime.utcnow().isoformat() + 'Z',
            'version': cls.VERSION,
            'source': cls.SOURCE,
            'data': {
                'farms': [farm.to_dict() for farm in Farm.query.order_by(Farm.created_at.asc()).all()],
                'cows': [cow.to_dict() for cow in Cow.query.order_by(Cow.created_at.asc()).all()],
                'milkRecords': [record.to_dict() for record in MilkRecord.query.order_by(MilkRecord.record_date.asc()).all()],
                'healthRecords': [record.to_dict() for record in HealthRecord.query.order_by(HealthRecord.issue_date.asc()).all()],
                'reproductionEvents': [event.to_dict() for event in ReproductionEvent.query.order_by(ReproductionEvent.event_date.asc()).all()],
                'feedRecords': [record.to_dict() for record in FeedRecord.query.order_by(FeedRecord.feed_date.asc()).all()],
                'alerts': [alert.to_dict() for alert in Alert.query.order_by(Alert.created_at.asc()).all()]
            }
        }

    @classmethod
    def export_json_bytes(cls):
        payload = cls.export_payload()
        return json.dumps(payload, indent=2).encode('utf-8')

    @classmethod
    def parse_payload(cls, raw_content):
        try:
            parsed = json.loads(raw_content)
        except json.JSONDecodeError as exc:
            raise BackupValidationError(f'Invalid backup JSON: {exc.msg}') from exc

        payload = parsed.get('data') if isinstance(parsed, dict) and parsed.get('data') else parsed
        if not isinstance(payload, dict) or 'cows' not in payload:
            raise BackupValidationError('Backup JSON is missing cows data')
        return parsed, payload

    @classmethod
    def restore_json_bytes(cls, raw_bytes):
        raw_text = raw_bytes.decode('utf-8') if isinstance(raw_bytes, (bytes, bytearray)) else str(raw_bytes)
        parsed, payload = cls.parse_payload(raw_text)
        cls._restore_payload(payload)
        return {
            'version': parsed.get('version'),
            'source': parsed.get('source'),
            'restored_at': datetime.utcnow().isoformat() + 'Z',
            'counts': {
                'farms': len(payload.get('farms', [])),
                'cows': len(payload.get('cows', [])),
                'milkRecords': len(payload.get('milkRecords', payload.get('milk_records', []))),
                'healthRecords': len(payload.get('healthRecords', payload.get('health_records', []))),
                'reproductionEvents': len(payload.get('reproductionEvents', payload.get('reproduction_events', []))),
                'feedRecords': len(payload.get('feedRecords', payload.get('feed_records', []))),
                'alerts': len(payload.get('alerts', []))
            }
        }

    @classmethod
    def _restore_payload(cls, payload):
        from app.models import BreedType, CowStatus
        from app.utils.helpers import validate_date

        def as_datetime(value):
            if not value:
                return None
            normalized = str(value).replace('Z', '+00:00')
            return datetime.fromisoformat(normalized)

        with db.session.begin():
            db.session.query(Alert).delete()
            db.session.query(FeedRecord).delete()
            db.session.query(ReproductionEvent).delete()
            db.session.query(HealthRecord).delete()
            db.session.query(MilkRecord).delete()
            db.session.query(Cow).delete()
            db.session.query(Farm).delete()

            for farm_data in payload.get('farms', []):
                db.session.add(Farm(
                    id=farm_data.get('id'),
                    name=farm_data.get('name') or 'Farm',
                    location=farm_data.get('location'),
                    owner_name=farm_data.get('owner_name'),
                    total_animals=farm_data.get('total_animals'),
                    created_at=as_datetime(farm_data.get('created_at')) or datetime.utcnow(),
                    updated_at=as_datetime(farm_data.get('updated_at')) or datetime.utcnow()
                ))

            for cow_data in payload.get('cows', []):
                db.session.add(Cow(
                    id=cow_data.get('id'),
                    cow_uid=cow_data.get('cow_uid'),
                    name=cow_data.get('name') or 'Cow',
                    ear_tag=cow_data.get('ear_tag') or cow_data.get('cow_uid'),
                    breed=BreedType[cow_data.get('breed', 'mixed').upper()],
                    birth_date=validate_date(cow_data.get('birth_date')),
                    purchase_date=validate_date(cow_data.get('purchase_date')) if cow_data.get('purchase_date') else None,
                    breed_sequence=cow_data.get('breed_sequence'),
                    status=CowStatus[cow_data.get('status', 'heifer').upper()],
                    mother_id=cow_data.get('mother_id'),
                    photo_path=cow_data.get('photo_path'),
                    current_lactation_number=int(cow_data.get('current_lactation_number') or 0),
                    current_lactation_start_date=validate_date(cow_data.get('current_lactation_start_date')) if cow_data.get('current_lactation_start_date') else None,
                    created_at=as_datetime(cow_data.get('created_at')) or datetime.utcnow(),
                    updated_at=as_datetime(cow_data.get('updated_at')) or datetime.utcnow()
                ))

            for record_data in payload.get('milkRecords', payload.get('milk_records', [])):
                db.session.add(MilkRecord(
                    id=record_data.get('id'),
                    cow_id=record_data.get('cow_id'),
                    record_date=validate_date(record_data.get('record_date')),
                    morning_milk=record_data.get('morning_milk') or 0,
                    evening_milk=record_data.get('evening_milk') or 0,
                    total_milk=record_data.get('total_milk') or 0,
                    lactation_number=int(record_data.get('lactation_number') or 0),
                    quality_grade=record_data.get('quality_grade'),
                    notes=record_data.get('notes'),
                    created_at=as_datetime(record_data.get('created_at')) or datetime.utcnow(),
                    updated_at=as_datetime(record_data.get('updated_at')) or datetime.utcnow()
                ))

            for record_data in payload.get('healthRecords', payload.get('health_records', [])):
                db.session.add(HealthRecord(
                    id=record_data.get('id'),
                    cow_id=record_data.get('cow_id'),
                    issue_date=validate_date(record_data.get('issue_date') or record_data.get('record_date')),
                    symptom=record_data.get('symptom') or 'other',
                    diagnosis=record_data.get('diagnosis'),
                    description=record_data.get('description'),
                    temperature=record_data.get('temperature'),
                    treatment=record_data.get('treatment') or 'observation',
                    medicine_name=record_data.get('medicine_name') or record_data.get('medicine'),
                    medicine_dosage=record_data.get('medicine_dosage'),
                    veterinarian_contacted=bool(record_data.get('veterinarian_contacted') or record_data.get('vet_contacted')),
                    veterinarian_name=record_data.get('veterinarian_name'),
                    lactation_number=int(record_data.get('lactation_number') or 0),
                    recovery_status=record_data.get('recovery_status'),
                    recovery_date=validate_date(record_data.get('recovery_date')) if record_data.get('recovery_date') else None,
                    created_at=as_datetime(record_data.get('created_at')) or datetime.utcnow(),
                    updated_at=as_datetime(record_data.get('updated_at')) or datetime.utcnow()
                ))

            for event_data in payload.get('reproductionEvents', payload.get('reproduction_events', [])):
                details = event_data.get('details') or {}
                db.session.add(ReproductionEvent(
                    id=event_data.get('id'),
                    cow_id=event_data.get('cow_id'),
                    event_type=event_data.get('event_type') or event_data.get('type'),
                    event_date=validate_date(event_data.get('event_date') or event_data.get('record_date')),
                    heat_signs=event_data.get('heat_signs') or details.get('heat_signs'),
                    semen_type=event_data.get('semen_type') or details.get('semen_type'),
                    sire_name=event_data.get('sire_name') or details.get('sire_name'),
                    sire_id=event_data.get('sire_id') or details.get('sire_id'),
                    technician_name=event_data.get('technician_name') or details.get('technician_name'),
                    pregnancy_status=event_data.get('pregnancy_status') or details.get('pregnancy_status'),
                    expected_calving_date=validate_date(event_data.get('expected_calving_date') or details.get('expected_calving_date')) if (event_data.get('expected_calving_date') or details.get('expected_calving_date')) else None,
                    days_pregnant=event_data.get('days_pregnant') or details.get('days_pregnant'),
                    calf_gender=event_data.get('calf_gender') or details.get('calf_gender'),
                    calf_weight=event_data.get('calf_weight') or details.get('calf_weight'),
                    calf_id=event_data.get('calf_id') or details.get('calf_id'),
                    calving_difficulty=event_data.get('calving_difficulty') or details.get('calving_difficulty'),
                    lactation_number=int(event_data.get('lactation_number') or 0),
                    notes=event_data.get('notes') or details.get('notes'),
                    created_at=as_datetime(event_data.get('created_at') or event_data.get('recorded_at')) or datetime.utcnow(),
                    updated_at=as_datetime(event_data.get('updated_at')) or datetime.utcnow()
                ))

            for record_data in payload.get('feedRecords', payload.get('feed_records', [])):
                db.session.add(FeedRecord(
                    id=record_data.get('id'),
                    cow_id=record_data.get('cow_id'),
                    feed_date=validate_date(record_data.get('feed_date')),
                    feed_type=record_data.get('feed_type') or 'hay',
                    quantity=record_data.get('quantity') or 0,
                    cost_per_unit=record_data.get('cost_per_unit'),
                    total_cost=record_data.get('total_cost'),
                    supplier=record_data.get('supplier'),
                    batch_number=record_data.get('batch_number'),
                    quality_notes=record_data.get('quality_notes'),
                    created_at=as_datetime(record_data.get('created_at')) or datetime.utcnow(),
                    updated_at=as_datetime(record_data.get('updated_at')) or datetime.utcnow()
                ))

            for alert_data in payload.get('alerts', []):
                db.session.add(Alert(
                    id=alert_data.get('id'),
                    cow_id=alert_data.get('cow_id'),
                    alert_type=alert_data.get('alert_type') or 'info',
                    message=alert_data.get('message') or 'Imported alert',
                    severity=alert_data.get('severity') or 'info',
                    acknowledged=bool(alert_data.get('acknowledged')),
                    acknowledged_at=as_datetime(alert_data.get('acknowledged_at')),
                    acknowledged_by=alert_data.get('acknowledged_by'),
                    resolution_notes=alert_data.get('resolution_notes'),
                    resolved_at=as_datetime(alert_data.get('resolved_at')),
                    created_at=as_datetime(alert_data.get('created_at')) or datetime.utcnow(),
                    updated_at=as_datetime(alert_data.get('updated_at')) or datetime.utcnow()
                ))
