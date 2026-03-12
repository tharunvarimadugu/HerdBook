"""
API Routes for Milk Production Management
"""

from flask import Blueprint, request
from datetime import datetime
from app.models import MilkRecord, Cow
from database.db import db
from app.utils.helpers import (
    create_response, create_error_response, validate_date, paginate, get_json_payload,
    infer_lactation_number
)

milk_bp = Blueprint('milk', __name__, url_prefix='/api/v1/milk')


@milk_bp.route('/records', methods=['GET'])
def get_milk_records():
    """Get milk records with optional filters"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        cow_id = request.args.get('cow_id', None)
        date_from = request.args.get('date_from', None)
        date_to = request.args.get('date_to', None)
        
        query = MilkRecord.query
        
        if cow_id:
            query = query.filter_by(cow_id=cow_id)
        
        if date_from:
            start_date = validate_date(date_from)
            if start_date:
                query = query.filter(MilkRecord.record_date >= start_date)
        
        if date_to:
            end_date = validate_date(date_to)
            if end_date:
                query = query.filter(MilkRecord.record_date <= end_date)
        
        query = query.order_by(MilkRecord.record_date.desc())
        result = paginate(query, page, per_page)
        
        return create_response(result)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@milk_bp.route('/records/<record_id>', methods=['GET'])
def get_milk_record(record_id):
    """Get specific milk record"""
    try:
        record = db.session.get(MilkRecord, record_id)
        
        if not record:
            return create_error_response('Record not found', 404)
        
        return create_response(record.to_dict())
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@milk_bp.route('/records', methods=['POST'])
def create_milk_record():
    """Record milk production."""
    try:
        data, error = get_json_payload(required_fields=['cow_id', 'record_date', 'morning_milk', 'evening_milk'])
        if error:
            return error

        # Verify cow exists
        cow = db.session.get(Cow, data['cow_id'])
        if not cow:
            return create_error_response('Cow not found', 404)

        # Validate date
        record_date = validate_date(data['record_date'])
        if not record_date:
            return create_error_response('Invalid date format', 400)

        # Validate numbers
        try:
            morning = float(data['morning_milk'])
            evening = float(data['evening_milk'])
        except (ValueError, TypeError):
            return create_error_response('Invalid milk quantity', 400)

        # Check if record already exists
        existing = MilkRecord.query.filter_by(
            cow_id=data['cow_id'],
            record_date=record_date
        ).first()

        if existing:
            return create_error_response('Record already exists for this cow on this date', 400)

        # Create record
        lactation_number = data.get('lactation_number')
        if lactation_number is None:
            lactation_number = infer_lactation_number(cow, record_date)

        record = MilkRecord(
            cow_id=data['cow_id'],
            record_date=record_date,
            morning_milk=morning,
            evening_milk=evening,
            total_milk=morning + evening,
            lactation_number=max(int(lactation_number or 0), 0),
            quality_grade=data.get('quality_grade'),
            notes=data.get('notes')
        )

        db.session.add(record)
        db.session.commit()

        return create_response(
            record.to_dict(),
            message='Milk record created successfully',
            status_code=201
        )

    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@milk_bp.route('/records/<record_id>', methods=['PUT'])
def update_milk_record(record_id):
    """Update milk record"""
    try:
        record = db.session.get(MilkRecord, record_id)

        if not record:
            return create_error_response('Record not found', 404)

        data, error = get_json_payload(allow_empty=True)
        if error:
            return error

        if 'morning_milk' in data:
            record.morning_milk = float(data['morning_milk'])
        
        if 'evening_milk' in data:
            record.evening_milk = float(data['evening_milk'])
        
        if 'quality_grade' in data:
            record.quality_grade = data['quality_grade']

        if 'lactation_number' in data:
            record.lactation_number = max(int(data['lactation_number'] or 0), 0)
        
        if 'notes' in data:
            record.notes = data['notes']
        
        # Recalculate total
        record.total_milk = record.morning_milk + record.evening_milk
        
        db.session.commit()
        
        return create_response(record.to_dict(), message='Record updated')
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@milk_bp.route('/records/<record_id>', methods=['DELETE'])
def delete_milk_record(record_id):
    """Delete milk record"""
    try:
        record = db.session.get(MilkRecord, record_id)
        
        if not record:
            return create_error_response('Record not found', 404)
        
        db.session.delete(record)
        db.session.commit()
        
        return create_response(message='Record deleted')
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@milk_bp.route('/cow/<cow_id>/summary', methods=['GET'])
def get_cow_milk_summary(cow_id):
    """Get milk production summary for a cow"""
    try:
        from sqlalchemy import func
        days = request.args.get('days', 30, type=int)
        
        cow = db.session.get(Cow, cow_id)
        if not cow:
            return create_error_response('Cow not found', 404)
            
        # Optimize: calculate aggregations directly in the database
        stats = db.session.query(
            func.count(MilkRecord.id).label('total_records'),
            func.sum(MilkRecord.total_milk).label('total_milk'),
            func.max(MilkRecord.total_milk).label('max_daily'),
            func.min(MilkRecord.total_milk).label('min_daily'),
            func.avg(MilkRecord.total_milk).label('average_daily')
        ).filter(MilkRecord.cow_id == cow_id).first()
        
        # If no records exist, stats will have 0 or None
        total_records = stats.total_records or 0
        
        if total_records == 0:
            return create_response({
                'cow_id': cow_id,
                'total_records': 0,
                'average_daily': 0,
                'total_milk': 0
            })
            
        # Get recent records for display
        recent_records = MilkRecord.query.filter_by(cow_id=cow_id)\
            .order_by(MilkRecord.record_date.desc())\
            .limit(days)\
            .all()
        
        summary = {
            'cow_id': cow_id,
            'cow_name': cow.name,
            'total_records': total_records,
            'total_milk': float(stats.total_milk or 0),
            'average_daily': float(stats.average_daily or 0),
            'max_daily': float(stats.max_daily or 0),
            'min_daily': float(stats.min_daily or 0),
            'records': [r.to_dict() for r in recent_records]
        }
        
        return create_response(summary)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@milk_bp.route('/herd/summary', methods=['GET'])
def get_herd_milk_summary():
    """Get milk summary for entire herd"""
    try:
        from sqlalchemy import func, distinct
        
        today = datetime.today().date()
        
        # Today's production - Database Aggregated
        today_stats = db.session.query(
            func.count(distinct(MilkRecord.cow_id)).label('unique_cows'),
            func.sum(MilkRecord.total_milk).label('total_milk')
        ).filter(MilkRecord.record_date == today).first()
        
        today_cows = today_stats.unique_cows or 0
        today_milk = float(today_stats.total_milk or 0)
        
        # Monthly stats - Database Aggregated
        year = request.args.get('year', today.year, type=int)
        month = request.args.get('month', today.month, type=int)
        
        monthly_stats = db.session.query(
            func.count(MilkRecord.id).label('total_records'),
            func.sum(MilkRecord.total_milk).label('total_milk')
        ).filter(
            db.extract('year', MilkRecord.record_date) == year,
            db.extract('month', MilkRecord.record_date) == month
        ).first()
        
        month_records = monthly_stats.total_records or 0
        month_milk = float(monthly_stats.total_milk or 0)
        
        summary = {
            'today': {
                'date': today.isoformat(),
                'total_cows_milked': today_cows,
                'total_milk': today_milk,
                'average_per_cow': today_milk / today_cows if today_cows > 0 else 0
            },
            'monthly': {
                'year': year,
                'month': month,
                'total_records': month_records,
                'total_milk': month_milk,
                'average_daily': month_milk / month_records if month_records > 0 else 0
            }
        }
        
        return create_response(summary)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)
