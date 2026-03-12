"""
Utility functions and helpers
"""

from functools import wraps
from datetime import datetime, timedelta
from flask import jsonify, request
import logging

from app.models import ReproductionEvent


def create_response(data=None, message=None, status_code=200):
    """
    Standardized API response format
    """
    response = {
        'success': status_code < 400,
        'timestamp': datetime.utcnow().isoformat(),
        'status_code': status_code
    }
    
    if data is not None:
        response['data'] = data
    
    if message:
        response['message'] = message
    
    return jsonify(response), status_code


def create_error_response(message, status_code=400, errors=None):
    """
    Standardized error response
    """
    response = {
        'success': False,
        'timestamp': datetime.utcnow().isoformat(),
        'status_code': status_code,
        'message': message
    }
    
    if errors:
        response['errors'] = errors
    
    return jsonify(response), status_code


def paginate(query, page=1, per_page=20):
    """Paginate query results."""
    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    return {
        'items': [item.to_dict() if hasattr(item, 'to_dict') else item for item in paginated.items],
        'pagination': {
            'total': paginated.total,
            'pages': paginated.pages,
            'current_page': page,
            'per_page': per_page,
            'has_next': paginated.has_next,
            'has_prev': paginated.has_prev
        }
    }


def get_json_payload(required_fields=None, allow_empty=False):
    """Safely get JSON payload and validate required fields.

    Args:
        required_fields (list|tuple|set, optional): List of required keys.
        allow_empty (bool): If False, rejects empty payloads.

    Returns:
        tuple: (data, error_response)
            - data: parsed JSON dict (or None)
            - error_response: Flask response (or None)
    """
    from flask import request

    data = request.get_json(silent=True)

    if data is None:
        return None, create_error_response('Invalid or missing JSON payload', 400)

    if not allow_empty and not data:
        return None, create_error_response('Request JSON body is empty', 400)

    if required_fields:
        missing = [f for f in required_fields if f not in data or data.get(f) is None]
        if missing:
            return None, create_error_response(f'Missing fields: {", ".join(missing)}', 400)

    return data, None


def validate_date(date_string, format_str='%Y-%m-%d'):
    """
    Validate date string format
    """
    try:
        return datetime.strptime(date_string, format_str).date()
    except (ValueError, TypeError):
        return None


def calculate_age_months(birth_date):
    """
    Calculate age in months from birth date
    """
    today = datetime.today().date()
    months = (today.year - birth_date.year) * 12 + (today.month - birth_date.month)
    return max(0, months)


def calculate_age_years(birth_date):
    """
    Calculate age in years from birth date
    """
    return calculate_age_months(birth_date) / 12


def calculate_lactation_days(birth_date, calving_date):
    """
    Calculate days in current lactation
    """
    if not calving_date:
        return None
    today = datetime.today().date()
    return (today - calving_date).days


def get_production_status(milk_quantity):
    """
    Classify milk production level
    """
    if milk_quantity >= 20:
        return 'high-producer'
    elif milk_quantity >= 15:
        return 'good-producer'
    elif milk_quantity >= 10:
        return 'normal-producer'
    else:
        return 'low-producer'


def get_status_color(status):
    """
    Get color code for status display
    """
    colors = {
        'healthy': '#27ae60',
        'attention': '#f39c12',
        'critical': '#e74c3c',
        'pregnant': '#3498db',
        'normal': '#95a5a6'
    }
    return colors.get(status, '#95a5a6')


class Logger:
    """
    Application logger wrapper
    """
    
    def __init__(self, name):
        self.logger = logging.getLogger(name)
    
    def info(self, message, **kwargs):
        self.logger.info(f"{message} | {kwargs}")
    
    def warning(self, message, **kwargs):
        self.logger.warning(f"{message} | {kwargs}")
    
    def error(self, message, **kwargs):
        self.logger.error(f"{message} | {kwargs}")
    
    def debug(self, message, **kwargs):
        self.logger.debug(f"{message} | {kwargs}")


def get_date_range(range_type='month'):
    """
    Get start and end dates for analysis ranges
    """
    today = datetime.today().date()
    
    if range_type == 'today':
        return today, today
    elif range_type == 'week':
        start = today - timedelta(days=today.weekday())
        return start, today
    elif range_type == 'month':
        start = today.replace(day=1)
        return start, today
    elif range_type == 'year':
        start = today.replace(month=1, day=1)
        return start, today
    
    return today, today


def format_currency(amount, currency='₹'):
    """
    Format number as currency
    """
    return f"{currency} {amount:,.2f}"


def infer_lactation_number(cow, reference_date=None):
    """Infer lactation number from calving history up to the given date."""
    if not cow:
        return 0

    target_date = reference_date or datetime.utcnow().date()
    if isinstance(target_date, datetime):
        target_date = target_date.date()

    calving_count = ReproductionEvent.query.filter_by(
        cow_id=cow.id,
        event_type='calving'
    ).filter(
        ReproductionEvent.event_date <= target_date
    ).count()

    if calving_count > 0:
        return calving_count

    fallback = getattr(cow, 'current_lactation_number', 0) or 0
    return max(int(fallback), 0)
