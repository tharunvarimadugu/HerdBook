"""
API Routes for Cow/Herd Management
Endpoints for CRUD operations on cows
"""

from flask import Blueprint, request, send_file, current_app
from werkzeug.utils import secure_filename
from app.models import Cow, CowStatus, BreedType
from database.db import db
from app.utils.helpers import (
    create_response, create_error_response, validate_date,
    calculate_age_months, paginate, get_json_payload
)
from app.utils.id_generator import generate_cow_uid, validate_cow_uid_unique
import os
from datetime import datetime

herd_bp = Blueprint('herd', __name__, url_prefix='/api/v1/herd')

# Allowed photo extensions
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp', 'gif'}
MAX_PHOTO_FILE_SIZE = 16 * 1024 * 1024  # 16MB


def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def get_upload_folder():
    """Get or create upload folder.

    Uses `UPLOAD_FOLDER` config as base (default: backend/uploads), then
    stores cow photos in a `cow_photos/` subfolder.
    """
    base_upload = current_app.config.get('UPLOAD_FOLDER')

    if not base_upload:
        base_upload = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            '..', 'uploads'
        )

    upload_folder = os.path.join(base_upload, 'cow_photos')
    upload_folder = os.path.abspath(upload_folder)
    os.makedirs(upload_folder, exist_ok=True)
    return upload_folder


# ===== GET ENDPOINTS =====

@herd_bp.route('/cows', methods=['GET'])
def get_all_cows():
    """Get all cows with pagination"""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        status = request.args.get('status', None, type=str)
        
        query = Cow.query
        
        if status:
            try:
                status_enum = CowStatus[status.upper()]
                query = query.filter_by(status=status_enum)
            except KeyError:
                return create_error_response('Invalid status', 400)
        
        result = paginate(query, page, per_page)
        return create_response(result)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@herd_bp.route('/cows/<cow_id>', methods=['GET'])
def get_cow(cow_id):
    """Get specific cow details"""
    try:
        cow = db.session.get(Cow, cow_id)
        
        if not cow:
            return create_error_response('Cow not found', 404)
        
        cow_data = cow.to_dict(include_relations=True)
        return create_response(cow_data)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@herd_bp.route('/cows/tag/<ear_tag>', methods=['GET'])
def get_cow_by_tag(ear_tag):
    """Get cow by ear tag"""
    try:
        cow = Cow.query.filter_by(ear_tag=ear_tag).first()
        
        if not cow:
            return create_error_response('Cow not found', 404)
        
        return create_response(cow.to_dict())
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@herd_bp.route('/stats', methods=['GET'])
def get_herd_stats():
    """Get herd statistics natively aggregated by the database"""
    try:
        from sqlalchemy import func
        
        # 1. Total count
        total_cows = db.session.query(func.count(Cow.id)).scalar() or 0
        
        stats = {
            'total_cows': total_cows,
            'by_status': {},
            'by_breed': {}
        }
        
        # 2. Count by status efficiently
        status_counts = db.session.query(Cow.status, func.count(Cow.id))\
            .group_by(Cow.status).all()
            
        for status_enum, count in status_counts:
            if status_enum:
                stats['by_status'][status_enum.value] = count
                
        # Fill in missing statuses with 0
        for status in CowStatus:
            if status.value not in stats['by_status']:
                stats['by_status'][status.value] = 0
        
        # 3. Count by breed efficiently
        breed_counts = db.session.query(Cow.breed, func.count(Cow.id))\
            .group_by(Cow.breed).all()
            
        for breed_enum, count in breed_counts:
            if breed_enum:
                stats['by_breed'][breed_enum.value] = count
                
        # Fill in missing breeds with 0
        for breed in BreedType:
            if breed.value not in stats['by_breed']:
                stats['by_breed'][breed.value] = 0
        
        return create_response(stats)
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


# ===== UID GENERATION ENDPOINT =====

@herd_bp.route('/generate-uid', methods=['POST'])
def generate_uid():
    """Generate unique cow ID without creating cow"""
    try:
        data, error = get_json_payload(required_fields=['breed', 'birth_date'])
        if error:
            return error

        breed_str = data.get('breed')
        birth_date_str = data.get('birth_date')

        # Validate and convert breed
        try:
            breed = BreedType[breed_str.upper()]
        except KeyError:
            return create_error_response('Invalid breed', 400)

        # Validate date
        birth_date = validate_date(birth_date_str)
        if not birth_date:
            return create_error_response('Invalid birth_date format (YYYY-MM-DD)', 400)

        # Generate UID
        cow_uid, breed_sequence = generate_cow_uid(breed, birth_date, db, Cow)

        return create_response({
            'cow_uid': cow_uid,
            'breed_sequence': breed_sequence,
            'format': '<BreedCode>-<YearMonth>-<Sequence>',
            'example': 'HF-202401-001 (Holstein born Jan 2024, sequence 1)'
        }, message='Unique ID generated successfully')

    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


# ===== POST ENDPOINTS =====

@herd_bp.route('/cows', methods=['POST'])
def create_cow():
    """Add new cow to herd"""
    try:
        data, error = get_json_payload(required_fields=['ear_tag', 'breed', 'birth_date'])
        if error:
            return error
        
        # Check if ear_tag already exists
        if Cow.query.filter_by(ear_tag=data['ear_tag']).first():
            return create_error_response('Ear tag already exists', 400)
        
        # Validate date
        birth_date = validate_date(data['birth_date'])
        if not birth_date:
            return create_error_response('Invalid birth_date format (YYYY-MM-DD)', 400)
        
        purchase_date = None
        if data.get('purchase_date'):
            purchase_date = validate_date(data['purchase_date'])
            if not purchase_date:
                return create_error_response('Invalid purchase_date format', 400)
        
        # Validate breed
        try:
            breed = BreedType[data['breed'].upper()]
        except KeyError:
            return create_error_response('Invalid breed', 400)
        
        # Validate status
        status = CowStatus.HEIFER
        if data.get('status'):
            try:
                status = CowStatus[data['status'].upper()]
            except KeyError:
                return create_error_response('Invalid status', 400)

        current_lactation_number = max(int(data.get('current_lactation_number') or 0), 0)
        current_lactation_start_date = None
        if data.get('current_lactation_start_date'):
            current_lactation_start_date = validate_date(data['current_lactation_start_date'])
            if not current_lactation_start_date:
                return create_error_response('Invalid current_lactation_start_date format (YYYY-MM-DD)', 400)
        
        # Generate unique cow UID and handle potential race conditions
        cow_uid = None
        breed_sequence = None
        max_attempts = 5
        for attempt in range(max_attempts):
            cow_uid, breed_sequence = generate_cow_uid(breed, birth_date, db, Cow)

            # Verify uniqueness
            if not validate_cow_uid_unique(cow_uid, db, Cow):
                continue

            # Create cow
            cow = Cow(
                cow_uid=cow_uid,
                name=data.get('name') or f"Cow {cow_uid}",
                ear_tag=data['ear_tag'],
                breed=breed,
                birth_date=birth_date,
                purchase_date=purchase_date,
                breed_sequence=breed_sequence,
                status=status,
                mother_id=data.get('mother_id'),
                current_lactation_number=current_lactation_number,
                current_lactation_start_date=current_lactation_start_date
            )

            db.session.add(cow)
            try:
                db.session.commit()
                break
            except Exception as exc:
                db.session.rollback()
                # If we can't write due to unique constraint, retry UIDs.
                # Otherwise re-raise
                from sqlalchemy.exc import IntegrityError
                if isinstance(exc, IntegrityError) and attempt + 1 < max_attempts:
                    continue
                raise

        else:
            return create_error_response('Unable to generate unique cow ID after multiple attempts', 500)

        return create_response(
            cow.to_dict(),
            message='Cow added successfully',
            status_code=201
        )
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


# ===== PUT ENDPOINTS =====

@herd_bp.route('/cows/<cow_id>', methods=['PUT'])
def update_cow(cow_id):
    """Update cow details"""
    try:
        cow = db.session.get(Cow, cow_id)

        if not cow:
            return create_error_response('Cow not found', 404)

        data, error = get_json_payload(allow_empty=True)
        if error:
            return error

        # Update allowed fields
        if 'name' in data:
            cow.name = data['name']
        
        if 'status' in data:
            try:
                cow.status = CowStatus[data['status'].upper()]
            except KeyError:
                return create_error_response('Invalid status', 400)
        
        if 'breed' in data:
            try:
                cow.breed = BreedType[data['breed'].upper()]
            except KeyError:
                return create_error_response('Invalid breed', 400)
        
        if 'ear_tag' in data:
            # Check if new ear tag is unique
            if data['ear_tag'] != cow.ear_tag and Cow.query.filter_by(ear_tag=data['ear_tag']).first():
                return create_error_response('Ear tag already exists', 400)
            cow.ear_tag = data['ear_tag']
        
        if 'purchase_date' in data:
            if data['purchase_date']:
                purchase_date = validate_date(data['purchase_date'])
                if not purchase_date:
                    return create_error_response('Invalid purchase_date format (YYYY-MM-DD)', 400)
                cow.purchase_date = purchase_date
            else:
                cow.purchase_date = None
        
        if 'mother_id' in data:
            cow.mother_id = data['mother_id']

        if 'current_lactation_number' in data:
            cow.current_lactation_number = max(int(data['current_lactation_number'] or 0), 0)

        if 'current_lactation_start_date' in data:
            if data['current_lactation_start_date']:
                current_lactation_start_date = validate_date(data['current_lactation_start_date'])
                if not current_lactation_start_date:
                    return create_error_response('Invalid current_lactation_start_date format (YYYY-MM-DD)', 400)
                cow.current_lactation_start_date = current_lactation_start_date
            else:
                cow.current_lactation_start_date = None
        
        cow.updated_at = datetime.utcnow()
        db.session.commit()
        
        return create_response(
            cow.to_dict(),
            message='Cow updated successfully'
        )
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


# ===== DELETE ENDPOINTS =====

@herd_bp.route('/cows/<cow_id>', methods=['DELETE'])
def delete_cow(cow_id):
    """Remove cow from herd"""
    try:
        cow = db.session.get(Cow, cow_id)
        
        if not cow:
            return create_error_response('Cow not found', 404)
        
        db.session.delete(cow)
        db.session.commit()
        
        return create_response(
            message='Cow removed successfully'
        )
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


# ===== UTILITY ENDPOINTS =====

@herd_bp.route('/breeds', methods=['GET'])
def get_breeds():
    """Get list of available breeds"""
    breeds = [{'name': breed.value, 'display': breed.name} for breed in BreedType]
    return create_response(breeds)


@herd_bp.route('/statuses', methods=['GET'])
def get_statuses():
    """Get list of available statuses"""
    statuses = [{'name': status.value, 'display': status.name} for status in CowStatus]
    return create_response(statuses)

# ===== PHOTO MANAGEMENT ENDPOINTS =====

@herd_bp.route('/cows/<cow_id>/photo', methods=['POST'])
def upload_cow_photo(cow_id):
    """Upload a JPEG photo for a cow"""
    try:
        cow = db.session.get(Cow, cow_id)
        
        if not cow:
            return create_error_response('Cow not found', 404)
        
        # Check if file is in request
        if 'photo' not in request.files:
            return create_error_response('No photo file provided', 400)
        
        file = request.files['photo']
        
        if file.filename == '':
            return create_error_response('No file selected', 400)
        
        if not allowed_file(file.filename):
            return create_error_response('Unsupported image format. Allowed: jpg, png, webp, gif', 400)
        
        # Check file size
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)
        
        if file_size > MAX_PHOTO_FILE_SIZE:
            return create_error_response(f'File too large. Max size is 16MB', 400)
        
        # Create upload folder
        upload_folder = get_upload_folder()
        
        # Delete old photo if exists
        if cow.photo_path and os.path.exists(cow.photo_path):
            try:
                os.remove(cow.photo_path)
            except Exception as e:
                print(f"Warning: Could not delete old photo: {str(e)}")
        
        # Save file with cow_id as name to prevent duplicates
        ext = file.filename.rsplit('.', 1)[1].lower()
        safe_filename = secure_filename(f"{cow_id}.{ext}")
        filepath = os.path.join(upload_folder, safe_filename)

        file.save(filepath)
        
        # Update cow record
        cow.photo_path = filepath
        cow.updated_at = datetime.utcnow()
        db.session.commit()
        
        return create_response(
            {
                'id': cow.id,
                'photo_path': cow.photo_path,
                'photo_url': f'/api/v1/herd/cows/{cow.id}/photo'
            },
            message='Photo uploaded successfully',
            status_code=201
        )
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)


@herd_bp.route('/cows/<cow_id>/photo', methods=['GET'])
def get_cow_photo(cow_id):
    """Get/download photo for a cow"""
    try:
        cow = db.session.get(Cow, cow_id)
        
        if not cow:
            return create_error_response('Cow not found', 404)
        
        if not cow.photo_path or not os.path.exists(cow.photo_path):
            return create_error_response('Photo not found', 404)
        
        # Get correct mimetype
        ext = cow.photo_path.rsplit('.', 1)[-1].lower() if '.' in cow.photo_path else 'jpeg'
        mimetype = f'image/{ext}'
        if ext == 'jpg': mimetype = 'image/jpeg'

        return send_file(
            cow.photo_path,
            mimetype=mimetype,
            as_attachment=False
        )
    
    except Exception as e:
        return create_error_response(f'Error: {str(e)}', 500)


@herd_bp.route('/cows/<cow_id>/photo', methods=['DELETE'])
def delete_cow_photo(cow_id):
    """Delete photo for a cow"""
    try:
        cow = db.session.get(Cow, cow_id)
        
        if not cow:
            return create_error_response('Cow not found', 404)
        
        if not cow.photo_path:
            return create_error_response('No photo to delete', 404)
        
        # Delete file from disk
        if os.path.exists(cow.photo_path):
            try:
                os.remove(cow.photo_path)
            except Exception as e:
                return create_error_response(f'Error deleting photo: {str(e)}', 500)
        
        # Update database
        cow.photo_path = None
        cow.updated_at = datetime.utcnow()
        db.session.commit()
        
        return create_response(
            message='Photo deleted successfully'
        )
    
    except Exception as e:
        db.session.rollback()
        return create_error_response(f'Error: {str(e)}', 500)
