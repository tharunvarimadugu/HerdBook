"""
API Routes for Feed Management
"""

from flask import Blueprint, request
from datetime import datetime
from app.models import FeedRecord, Cow
from database.db import db
from app.utils.helpers import (
    create_response, create_error_response, validate_date, paginate, get_json_payload
)

feed_bp = Blueprint('feed', __name__, url_prefix='/api/v1/feed')


@feed_bp.route('/records', methods=['GET'])
def get_feed_records():
    """Get feed records with filters"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        cow_id = request.args.get('cow_id', None)
        feed_type = request.args.get('feed_type', None)
        date_from = request.args.get('date_from', None)
        date_to = request.args.get('date_to', None)
        
        query = FeedRecord.query
        
        if cow_id:
            query = query.filter_by(cow_id=cow_id)
        
        if feed_type:
            query = query.filter_by(feed_type=feed_type)
        
        if date_from:
            start_date = validate_date(date_from)
            if start_date:
                query = query.filter(FeedRecord.feed_date >= start_date)
        
        if date_to:
            end_date = validate_date(date_to)
            if end_date:
                query = query.filter(FeedRecord.feed_date <= end_date)
        
        query = query.order_by(FeedRecord.feed_date.desc())
        result = paginate(query, page, per_page)
        
        return create_response(result)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@feed_bp.route('/records/<record_id>', methods=['GET'])
def get_feed_record(record_id):
    """Get specific feed record"""
    try:
        record = db.session.get(FeedRecord, record_id)
        
        if not record:
            return create_error_response('Record not found', 404)
        
        return create_response(record.to_dict())
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@feed_bp.route('/records', methods=['POST'])
def create_feed_record():
    """Record feed usage."""
    try:
        data, error = get_json_payload(required_fields=['feed_date', 'feed_type', 'quantity'])
        if error:
            return error

        # Verify cow exists if cow_id provided
        if data.get('cow_id'):
            cow = db.session.get(Cow, data['cow_id'])
            if not cow:
                return create_error_response('Cow not found', 404)

        # Validate date
        feed_date = validate_date(data['feed_date'])
        if not feed_date:
            return create_error_response('Invalid date format', 400)

        # Validate quantity
        try:
            quantity = float(data['quantity'])
        except (ValueError, TypeError):
            return create_error_response('Invalid quantity', 400)

        # Calculate total cost
        cost_per_unit = data.get('cost_per_unit')
        total_cost = None

        if cost_per_unit:
            try:
                cost_per_unit = float(cost_per_unit)
                total_cost = quantity * cost_per_unit
            except (ValueError, TypeError):
                return create_error_response('Invalid cost_per_unit', 400)

        # Create record
        record = FeedRecord(
            cow_id=data.get('cow_id'),
            feed_date=feed_date,
            feed_type=data['feed_type'],
            quantity=quantity,
            cost_per_unit=cost_per_unit,
            total_cost=total_cost,
            supplier=data.get('supplier'),
            batch_number=data.get('batch_number'),
            quality_notes=data.get('quality_notes')
        )

        db.session.add(record)
        db.session.commit()

        return create_response(
            record.to_dict(),
            message='Feed record created',
            status_code=201
        )

    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@feed_bp.route('/records/<record_id>', methods=['PUT'])
def update_feed_record(record_id):
    """Update feed record"""
    try:
        record = db.session.get(FeedRecord, record_id)

        if not record:
            return create_error_response('Record not found', 404)

        data, error = get_json_payload(allow_empty=True)
        if error:
            return error
        
        if 'feed_date' in data:
            feed_date = validate_date(data['feed_date'])
            if not feed_date:
                return create_error_response('Invalid date format', 400)
            record.feed_date = feed_date
        
        if 'feed_type' in data:
            record.feed_type = data['feed_type']
        
        if 'quantity' in data:
            try:
                record.quantity = float(data['quantity'])
            except (ValueError, TypeError):
                return create_error_response('Invalid quantity', 400)
        
        if 'cost_per_unit' in data:
            if data['cost_per_unit']:
                try:
                    record.cost_per_unit = float(data['cost_per_unit'])
                except (ValueError, TypeError):
                    return create_error_response('Invalid cost_per_unit', 400)
            else:
                record.cost_per_unit = None
        
        # Recalculate total cost
        if record.cost_per_unit is not None and record.quantity is not None:
            record.total_cost = record.quantity * record.cost_per_unit
        else:
            record.total_cost = None
        
        if 'supplier' in data:
            record.supplier = data['supplier']
        
        if 'batch_number' in data:
            record.batch_number = data['batch_number']
        
        if 'quality_notes' in data:
            record.quality_notes = data['quality_notes']
        
        record.updated_at = datetime.utcnow()
        db.session.commit()
        
        return create_response(
            record.to_dict(),
            message='Feed record updated'
        )
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@feed_bp.route('/records/<record_id>', methods=['DELETE'])
def delete_feed_record(record_id):
    """Delete feed record"""
    try:
        record = db.session.get(FeedRecord, record_id)
        
        if not record:
            return create_error_response('Record not found', 404)
        
        db.session.delete(record)
        db.session.commit()
        
        return create_response(message='Feed record deleted')
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@feed_bp.route('/types', methods=['GET'])
def get_feed_types():
    """Get available feed types"""
    types = FeedRecord.FEED_TYPES
    return create_response(types)


@feed_bp.route('/stats', methods=['GET'])
def get_feed_stats():
    """Get feed statistics"""
    try:
        date_from = request.args.get('date_from', None)
        date_to = request.args.get('date_to', None)
        
        query = FeedRecord.query
        
        if date_from:
            start_date = validate_date(date_from)
            if start_date:
                query = query.filter(FeedRecord.feed_date >= start_date)
        
        if date_to:
            end_date = validate_date(date_to)
            if end_date:
                query = query.filter(FeedRecord.feed_date <= end_date)
        
        records = query.all()
        
        stats = {
            'total_records': len(records),
            'total_quantity_kg': sum(r.quantity for r in records),
            'total_cost': sum(r.total_cost or 0 for r in records),
            'by_type': {}
        }
        
        # Group by feed type
        for record in records:
            if record.feed_type not in stats['by_type']:
                stats['by_type'][record.feed_type] = {
                    'quantity': 0,
                    'cost': 0
                }
            stats['by_type'][record.feed_type]['quantity'] += record.quantity
            stats['by_type'][record.feed_type]['cost'] += record.total_cost or 0
        
        return create_response(stats)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)
