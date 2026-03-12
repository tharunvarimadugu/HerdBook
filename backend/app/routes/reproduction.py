"""
API Routes for Reproduction Management
"""

from flask import Blueprint, request
from datetime import datetime, timedelta
from app.models import ReproductionEvent, Cow, CowStatus, Alert
from database.db import db
from app.utils.helpers import (
    create_response, create_error_response, validate_date, paginate, get_json_payload,
    infer_lactation_number
)

reproduction_bp = Blueprint('reproduction', __name__, url_prefix='/api/v1/reproduction')

WORKFLOW_ALERT_TYPES = {
    'pregnancy_check_3m': 'workflow-pregnancy-check-3m',
    'stop_milking_6m': 'workflow-stop-milking-6m',
    'dry_period_7m': 'workflow-dry-period-7m'
}


def _latest_ai_event(cow_id):
    return ReproductionEvent.query.filter_by(
        cow_id=cow_id,
        event_type='ai'
    ).order_by(ReproductionEvent.event_date.desc()).first()


def _latest_pregnancy_event(cow_id):
    return ReproductionEvent.query.filter_by(
        cow_id=cow_id,
        event_type='pregnancy-check'
    ).order_by(ReproductionEvent.event_date.desc()).first()


def _latest_workflow_answer(cow_id, alert_type):
    return Alert.query.filter_by(
        cow_id=cow_id,
        alert_type=alert_type
    ).filter(
        Alert.resolved_at.isnot(None)
    ).order_by(Alert.resolved_at.desc(), Alert.created_at.desc()).first()


def _open_workflow_alert(cow_id, alert_type):
    return Alert.query.filter_by(
        cow_id=cow_id,
        alert_type=alert_type
    ).filter(
        Alert.resolved_at.is_(None)
    ).order_by(Alert.created_at.desc()).first()


def _resolve_open_alerts(cow_id, alert_type, resolution_note):
    alerts = Alert.query.filter_by(
        cow_id=cow_id,
        alert_type=alert_type
    ).filter(Alert.resolved_at.is_(None)).all()
    now = datetime.utcnow()
    for alert in alerts:
        alert.acknowledged = True
        alert.acknowledged_at = now
        alert.resolution_notes = resolution_note
        alert.resolved_at = now


def _ensure_open_alert(cow, alert_type, message, severity='warning'):
    existing = _open_workflow_alert(cow.id, alert_type)
    if existing:
        existing.message = message
        existing.severity = severity
        return existing, False

    alert = Alert(
        cow_id=cow.id,
        alert_type=alert_type,
        message=message,
        severity=severity
    )
    db.session.add(alert)
    return alert, True


def _workflow_state(cow_id):
    state = {
        'pregnancy_confirmed': None,
        'stop_milking_confirmed': None,
        'dry_period_confirmed': None
    }

    latest_pregnancy = _latest_pregnancy_event(cow_id)
    if latest_pregnancy and latest_pregnancy.pregnancy_status:
        if latest_pregnancy.pregnancy_status == 'confirmed':
            state['pregnancy_confirmed'] = 'yes'
        elif latest_pregnancy.pregnancy_status in ('not-confirmed', 'recheck'):
            state['pregnancy_confirmed'] = 'no'

    for key, alert_type in (
        ('stop_milking_confirmed', WORKFLOW_ALERT_TYPES['stop_milking_6m']),
        ('dry_period_confirmed', WORKFLOW_ALERT_TYPES['dry_period_7m'])
    ):
        answer_alert = _latest_workflow_answer(cow_id, alert_type)
        if answer_alert and answer_alert.resolution_notes:
            state[key] = 'yes' if str(answer_alert.resolution_notes).strip().lower() == 'yes' else 'no'

    return state


def _sync_workflow_alerts_for_cow(cow, reference_date=None):
    ai_event = _latest_ai_event(cow.id)
    if not ai_event:
        return 0

    alerts_created = 0
    today = reference_date or datetime.utcnow().date()
    state = _workflow_state(cow.id)

    month3 = ai_event.event_date + timedelta(days=90)
    month6 = ai_event.event_date + timedelta(days=180)
    month7 = ai_event.event_date + timedelta(days=210)

    if state['pregnancy_confirmed'] is None:
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['stop_milking_6m'], 'blocked-pending-pregnancy-confirmation')
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['dry_period_7m'], 'blocked-pending-pregnancy-confirmation')
        if today >= month3:
            _, created = _ensure_open_alert(
                cow,
                WORKFLOW_ALERT_TYPES['pregnancy_check_3m'],
                f'{cow.name} - AI follow-up due. After 3 months from AI on {ai_event.event_date.isoformat()}, is pregnancy confirmed?',
                'warning'
            )
            if created:
                alerts_created += 1
        return alerts_created

    _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['pregnancy_check_3m'], state['pregnancy_confirmed'])

    if state['pregnancy_confirmed'] != 'yes':
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['stop_milking_6m'], 'cancelled-not-pregnant')
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['dry_period_7m'], 'cancelled-not-pregnant')
        return alerts_created

    if today >= month6 and state['stop_milking_confirmed'] is None:
        _, created = _ensure_open_alert(
            cow,
            WORKFLOW_ALERT_TYPES['stop_milking_6m'],
            f'{cow.name} - Cow entered the 6th month after AI on {ai_event.event_date.isoformat()}. Stop milking this cow now?',
            'warning'
        )
        if created:
            alerts_created += 1
    elif state['stop_milking_confirmed'] is not None:
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['stop_milking_6m'], state['stop_milking_confirmed'])

    if today >= month7 and state['dry_period_confirmed'] is None:
        _, created = _ensure_open_alert(
            cow,
            WORKFLOW_ALERT_TYPES['dry_period_7m'],
            f'{cow.name} - 7th month check after AI on {ai_event.event_date.isoformat()}. Is this cow now in dry period?',
            'warning'
        )
        if created:
            alerts_created += 1
    elif state['dry_period_confirmed'] is not None:
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['dry_period_7m'], state['dry_period_confirmed'])

    return alerts_created


@reproduction_bp.route('/events', methods=['GET'])
def get_reproduction_events():
    """Get reproduction events with filters"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        cow_id = request.args.get('cow_id', None)
        event_type = request.args.get('event_type', None)
        
        query = ReproductionEvent.query
        
        if cow_id:
            query = query.filter_by(cow_id=cow_id)
        
        if event_type:
            query = query.filter_by(event_type=event_type)
        
        query = query.order_by(ReproductionEvent.event_date.desc())
        result = paginate(query, page, per_page)
        
        return create_response(result)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@reproduction_bp.route('/heat-detection', methods=['POST'])
def record_heat_detection():
    """Record heat detection"""
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'event_date', 'heat_signs'])
        if error:
            return error

        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)

        event_date = validate_date(data['event_date'])
        if not event_date:
            return create_error_response('Invalid date format', 400)
        
        event = ReproductionEvent(
            cow_id=data['cow_id'],
            event_type='heat-detection',
            event_date=event_date,
            heat_signs=data['heat_signs'],
            lactation_number=max(int(data.get('lactation_number') or infer_lactation_number(cow, event_date) or 0), 0)
        )
        
        db.session.add(event)
        
        # Create alert
        alert = Alert(
            cow_id=data['cow_id'],
            alert_type='heat-cycle',
            message=f'{cow.name} in heat - ready for AI',
            severity='info'
        )
        db.session.add(alert)
        
        db.session.commit()
        
        return create_response(event.to_dict(), message='Heat detection recorded', status_code=201)
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@reproduction_bp.route('/ai', methods=['POST'])
def record_ai():
    """Record artificial insemination

    Validation:
    - Only one AI per cow per day
    """
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'event_date', 'semen_type', 'sire_name'])
        if error:
            return error
        
        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)
        
        event_date = validate_date(data['event_date'])
        if not event_date:
            return create_error_response('Invalid date format', 400)
        
        # Check if AI already recorded for this cow on the same date
        existing_ai = ReproductionEvent.query.filter_by(
            cow_id=data['cow_id'],
            event_type='ai',
            event_date=event_date
        ).first()
        
        if existing_ai:
            return create_error_response(
                f'AI already recorded for {cow.name} on {event_date.isoformat()}. Only one AI per cow per day allowed.',
                400
            )
        
        event = ReproductionEvent(
            cow_id=data['cow_id'],
            event_type='ai',
            event_date=event_date,
            semen_type=data['semen_type'],
            sire_name=data['sire_name'],
            sire_id=data.get('sire_id'),
            technician_name=data.get('technician_name'),
            lactation_number=max(int(data.get('lactation_number') or infer_lactation_number(cow, event_date) or 0), 0)
        )
        
        db.session.add(event)
        
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['pregnancy_check_3m'], 'superseded-by-new-ai')
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['stop_milking_6m'], 'superseded-by-new-ai')
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['dry_period_7m'], 'superseded-by-new-ai')
        
        db.session.commit()
        
        return create_response(event.to_dict(), message='AI recorded', status_code=201)
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@reproduction_bp.route('/pregnancy-check', methods=['POST'])
def record_pregnancy():
    """Record pregnancy check

    Alerts:
    - Creates stop milking alert at 6 months if pregnancy confirmed
    """
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'event_date', 'pregnancy_status'])
        if error:
            return error
        
        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)
        
        event_date = validate_date(data['event_date'])
        if not event_date:
            return create_error_response('Invalid date format', 400)
        
        event = ReproductionEvent(
            cow_id=data['cow_id'],
            event_type='pregnancy-check',
            event_date=event_date,
            pregnancy_status=data['pregnancy_status'],
            expected_calving_date=validate_date(data['expected_calving_date']) if data.get('expected_calving_date') else None,
            days_pregnant=data.get('days_pregnant'),
            lactation_number=max(int(data.get('lactation_number') or infer_lactation_number(cow, event_date) or 0), 0)
        )
        
        db.session.add(event)
        
        _resolve_open_alerts(cow.id, 'pregnancy-review', data['pregnancy_status'])

        if data['pregnancy_status'] == 'confirmed':
            cow.status = CowStatus.PREGNANT
        elif data['pregnancy_status'] == 'not-confirmed' and cow.status == CowStatus.PREGNANT:
            cow.status = CowStatus.MILKING

        _sync_workflow_alerts_for_cow(cow, event_date)
        
        db.session.commit()
        
        return create_response(event.to_dict(), message='Pregnancy recorded', status_code=201)
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@reproduction_bp.route('/calving', methods=['POST'])
def record_calving():
    """Record calving event"""
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'event_date', 'calf_gender'])
        if error:
            return error

        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)

        event_date = validate_date(data['event_date'])
        if not event_date:
            return create_error_response('Invalid date format', 400)
        
        next_lactation_number = max(int(cow.current_lactation_number or 0), 0) + 1
        event = ReproductionEvent(
            cow_id=data['cow_id'],
            event_type='calving',
            event_date=event_date,
            calf_gender=data['calf_gender'],
            calf_weight=data.get('calf_weight'),
            calving_difficulty=data.get('calving_difficulty'),
            lactation_number=next_lactation_number
        )
        
        db.session.add(event)
        
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['pregnancy_check_3m'], 'calved')
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['stop_milking_6m'], 'calved')
        _resolve_open_alerts(cow.id, WORKFLOW_ALERT_TYPES['dry_period_7m'], 'calved')

        # Update cow status to milking
        cow.status = CowStatus.MILKING
        cow.current_lactation_number = next_lactation_number
        cow.current_lactation_start_date = event_date
        
        db.session.commit()
        
        return create_response(event.to_dict(), message='Calving recorded', status_code=201)
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@reproduction_bp.route('/cow/<cow_id>/cycle', methods=['GET'])
def get_cow_reproduction_cycle(cow_id):
    """Get cow's current reproduction cycle"""
    try:
        cow = db.session.get(Cow, cow_id)
        if not cow:
            return create_error_response('Cow not found', 404)
        
        events = ReproductionEvent.query.filter_by(cow_id=cow_id)\
            .order_by(ReproductionEvent.event_date.asc())\
            .all()
        
        return create_response({
            'cow_id': cow_id,
            'cow_name': cow.name,
            'current_status': cow.status.value,
            'total_events': len(events),
            'events': [e.to_dict() for e in events]
        })
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@reproduction_bp.route('/workflow-feedback', methods=['POST'])
def record_workflow_feedback():
    """Persist reproduction workflow yes/no answers and next alert state."""
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'workflow_type', 'answer'])
        if error:
            return error

        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)

        workflow_type = data['workflow_type']
        alert_type = WORKFLOW_ALERT_TYPES.get(workflow_type)
        if not alert_type:
            return create_error_response('Invalid workflow type', 400)

        answer = str(data['answer']).strip().lower()
        if answer not in ('yes', 'no'):
            return create_error_response('Answer must be yes or no', 400)

        response_date = validate_date(data.get('response_date')) if data.get('response_date') else datetime.utcnow().date()
        if not response_date:
            return create_error_response('Invalid response date format', 400)

        event = None

        if workflow_type == 'pregnancy_check_3m':
            pregnancy_status = 'confirmed' if answer == 'yes' else 'not-confirmed'
            event = ReproductionEvent(
                cow_id=cow.id,
                event_type='pregnancy-check',
                event_date=response_date,
                pregnancy_status=pregnancy_status,
                notes='Recorded from workflow feedback',
                lactation_number=max(int(infer_lactation_number(cow, response_date) or 0), 0)
            )
            db.session.add(event)
            cow.status = CowStatus.PREGNANT if answer == 'yes' else CowStatus.MILKING
        elif workflow_type == 'stop_milking_6m':
            event = ReproductionEvent(
                cow_id=cow.id,
                event_type='recheck',
                event_date=response_date,
                notes=f'stop_milking:{answer}',
                lactation_number=max(int(infer_lactation_number(cow, response_date) or 0), 0)
            )
            db.session.add(event)
        elif workflow_type == 'dry_period_7m':
            event = ReproductionEvent(
                cow_id=cow.id,
                event_type='recheck',
                event_date=response_date,
                notes=f'dry_period:{answer}',
                lactation_number=max(int(infer_lactation_number(cow, response_date) or 0), 0)
            )
            db.session.add(event)
            cow.status = CowStatus.DRY if answer == 'yes' else CowStatus.PREGNANT

        open_alert = _open_workflow_alert(cow.id, alert_type)
        if open_alert:
            open_alert.acknowledged = True
            open_alert.acknowledged_at = datetime.utcnow()
            open_alert.resolution_notes = answer
            open_alert.resolved_at = datetime.utcnow()
        else:
            completed_alert = Alert(
                cow_id=cow.id,
                alert_type=alert_type,
                message=f'Workflow response recorded for {workflow_type}',
                severity='info',
                acknowledged=True,
                acknowledged_at=datetime.utcnow(),
                resolution_notes=answer,
                resolved_at=datetime.utcnow()
            )
            db.session.add(completed_alert)

        alerts_created = _sync_workflow_alerts_for_cow(cow, response_date)
        db.session.commit()

        return create_response({
            'cow_id': cow.id,
            'workflow_type': workflow_type,
            'answer': answer,
            'cow_status': cow.status.value,
            'event': event.to_dict() if event else None,
            'alerts_created': alerts_created
        }, message='Workflow feedback recorded')
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@reproduction_bp.route('/check-alerts', methods=['POST'])
def check_and_create_alerts():
    """
    Check all cows for pregnancy review and stop milking alerts
    Should be called periodically (daily) to update alerts
    """
    try:
        today = datetime.utcnow().date()
        alerts_created = 0
        
        ai_cow_ids = {
            event.cow_id
            for event in ReproductionEvent.query.filter_by(event_type='ai').all()
            if event.cow_id
        }

        for cow_id in ai_cow_ids:
            cow = db.session.get(Cow, cow_id)
            if not cow:
                continue
            alerts_created += _sync_workflow_alerts_for_cow(cow, today)
        
        db.session.commit()
        
        return create_response({
            'alerts_created': alerts_created,
            'check_date': today.isoformat()
        }, message='Alert check completed')
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)
