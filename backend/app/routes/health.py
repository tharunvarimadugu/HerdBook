"""
API Routes for Health Monitoring
"""

from flask import Blueprint, request
from datetime import datetime
from app.models import HealthRecord, Cow, Alert
from database.db import db
from app.utils.helpers import (
    create_response, create_error_response, validate_date, paginate, get_json_payload,
    infer_lactation_number
)

health_bp = Blueprint('health', __name__, url_prefix='/api/v1/health')


@health_bp.route('/records', methods=['GET'])
def get_health_records():
    """Get health records with filters"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        cow_id = request.args.get('cow_id', None)
        symptom = request.args.get('symptom', None)
        
        query = HealthRecord.query
        
        if cow_id:
            query = query.filter_by(cow_id=cow_id)
        
        if symptom:
            query = query.filter_by(symptom=symptom)
        
        query = query.order_by(HealthRecord.issue_date.desc())
        result = paginate(query, page, per_page)
        
        return create_response(result)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@health_bp.route('/records', methods=['POST'])
def create_health_record():
    """Record health issue"""
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'symptom', 'treatment'])
        if error:
            return error
        
        # Verify cow exists
        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)
        
        # Validate date
        issue_date_value = data.get('issue_date') or data.get('record_date')
        issue_date = validate_date(issue_date_value)
        if not issue_date:
            return create_error_response('Invalid date format', 400)
        
        # Create record
        lactation_number = data.get('lactation_number')
        if lactation_number is None:
            lactation_number = infer_lactation_number(cow, issue_date)

        record = HealthRecord(
            cow_id=data['cow_id'],
            issue_date=issue_date,
            symptom=data['symptom'],
            diagnosis=data.get('diagnosis'),
            description=data.get('description'),
            temperature=data.get('temperature'),
            treatment=data['treatment'],
            medicine_name=data.get('medicine_name') or data.get('medicine'),
            medicine_dosage=data.get('medicine_dosage'),
            veterinarian_contacted=data.get('veterinarian_contacted', False),
            veterinarian_name=data.get('veterinarian_name'),
            lactation_number=max(int(lactation_number or 0), 0)
        )
        
        db.session.add(record)
        
        # Auto-create alert for serious issues
        if data['symptom'] in ['fever', 'mastitis']:
            alert = Alert(
                cow_id=data['cow_id'],
                alert_type='health-issue',
                message=f'{data["symptom"]} detected in {cow.name}',
                severity='critical'
            )
            db.session.add(alert)
        
        db.session.commit()
        
        return create_response(
            record.to_dict(),
            message='Health record created',
            status_code=201
        )
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@health_bp.route('/records/<record_id>', methods=['PUT'])
def update_health_record(record_id):
    """Update health record"""
    try:
        record = db.session.get(HealthRecord, record_id)

        if not record:
            return create_error_response('Record not found', 404)

        data, error = get_json_payload(allow_empty=True)
        if error:
            return error

        if 'treatment' in data:
            record.treatment = data['treatment']
        if 'medicine_name' in data:
            record.medicine_name = data['medicine_name']
        if 'recovery_status' in data:
            record.recovery_status = data['recovery_status']
        if 'recovery_date' in data:
            record.recovery_date = validate_date(data['recovery_date'])
        if 'lactation_number' in data:
            record.lactation_number = max(int(data['lactation_number'] or 0), 0)
        
        db.session.commit()
        
        return create_response(record.to_dict(), message='Record updated')
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@health_bp.route('/cow/<cow_id>/history', methods=['GET'])
def get_cow_health_history(cow_id):
    """Get cow's health history"""
    try:
        cow = db.session.get(Cow, cow_id)
        if not cow:
            return create_error_response('Cow not found', 404)
        
        records = HealthRecord.query.filter_by(cow_id=cow_id)\
            .order_by(HealthRecord.issue_date.desc())\
            .all()
        
        return create_response({
            'cow_id': cow_id,
            'cow_name': cow.name,
            'total_issues': len(records),
            'records': [r.to_dict() for r in records]
        })
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@health_bp.route('/symptoms', methods=['GET'])
def get_symptoms():
    """Get list of available symptoms"""
    symptoms = HealthRecord.SYMPTOMS
    return create_response([{'name': s} for s in symptoms])


@health_bp.route('/alerts', methods=['GET'])
def get_alerts():
    """Get alerts with optional filters"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 100, type=int)
        cow_id = request.args.get('cow_id', None)
        alert_type = request.args.get('alert_type', None)
        unresolved_only = request.args.get('unresolved_only', 'false').lower() == 'true'

        query = Alert.query
        if cow_id:
            query = query.filter_by(cow_id=cow_id)
        if alert_type:
            query = query.filter_by(alert_type=alert_type)
        if unresolved_only:
            query = query.filter(Alert.resolved_at.is_(None))

        query = query.order_by(Alert.created_at.desc())
        result = paginate(query, page, per_page)
        return create_response(result)
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@health_bp.route('/alerts', methods=['POST'])
def create_alert():
    """Create a custom alert"""
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'alert_type', 'message'])
        if error:
            return error

        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)

        alert = Alert(
            cow_id=data['cow_id'],
            alert_type=data['alert_type'],
            message=data['message'],
            severity=data.get('severity', 'info')
        )
        db.session.add(alert)
        db.session.commit()

        return create_response(alert.to_dict(), message='Alert created', status_code=201)
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@health_bp.route('/alerts/<alert_id>', methods=['PUT'])
def update_alert(alert_id):
    """Update/resolve alert"""
    try:
        alert = db.session.get(Alert, alert_id)
        if not alert:
            return create_error_response('Alert not found', 404)

        data, error = get_json_payload(allow_empty=True)
        if error:
            return error

        if 'message' in data:
            alert.message = data['message']
        if 'severity' in data:
            alert.severity = data['severity']
        if 'acknowledged' in data:
            alert.acknowledged = bool(data['acknowledged'])
            alert.acknowledged_at = datetime.utcnow() if alert.acknowledged else None
        if 'resolution_notes' in data:
            alert.resolution_notes = data['resolution_notes']
        if 'resolved' in data:
            alert.resolved_at = datetime.utcnow() if bool(data['resolved']) else None

        db.session.commit()
        return create_response(alert.to_dict(), message='Alert updated')
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)
