"""
Database Models for Dairy Farm Management System
Core entities: Cows, Milk Records, Health, Reproduction, Feed, Alerts
"""

from database.db import db
from datetime import datetime
from enum import Enum
import uuid


class CowStatus(Enum):
    """Cow lifecycle status"""
    HEIFER = "heifer"
    MILKING = "milking"
    PREGNANT = "pregnant"
    DRY = "dry"
    HEALER = "healer"
    SOLD = "sold"
    DEAD = "dead"


class BreedType(Enum):
    """Cattle breeds"""
    HOLSTEIN = "holstein"
    JERSEY = "jersey"
    GUERNSEY = "guernsey"
    AYRSHIRE = "ayrshire"
    BROWN_SWISS = "brown_swiss"
    GIR = "gir"
    SAHIWAL = "sahiwal"
    RED_SINDHI = "red_sindhi"
    THARPARKAR = "tharparkar"
    RATHI = "rathi"
    KANKREJ = "kankrej"
    ONGOLE = "ongole"
    HARIANA = "hariana"
    HALLIKAR = "hallikar"
    KHILLAR = "khillar"
    DEONI = "deoni"
    KRISHNA_VALLEY = "krishna_valley"
    AMRITMAHAL = "amritmahal"
    NAGORI = "nagori"
    DHANGI = "dangi"
    MALNAD_GIDDA = "malnad_gidda"
    VECHUR = "vechur"
    PUNGANUR = "punganur"
    LADAKHI = "ladakhi"
    MEO = "meo"
    NIMARI = "nimari"
    KANGAYAM = "kangayam"
    UMBLACHERY = "umbalachery"
    PULIKULAM = "pulikulam"
    BARGUR = "bargur"
    ALAMBADI = "alambadi"
    KASARGOD_DWARF = "kasargod_dwarf"
    KENKATHA = "kenkatha"
    GAOLAO = "gaolao"
    LOCAL = "local"
    MIXED = "mixed"


class Cow(db.Model):
    """
    Core cow entity
    Represents an individual animal in the herd
    """
    __tablename__ = 'cows'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cow_uid = db.Column(db.String(20), unique=True, nullable=False, index=True)  # Auto-generated unique ID
    name = db.Column(db.String(100), nullable=False, index=True)
    ear_tag = db.Column(db.String(50), unique=True, nullable=False, index=True)
    breed = db.Column(db.Enum(BreedType), nullable=False)
    birth_date = db.Column(db.Date, nullable=False)
    purchase_date = db.Column(db.Date)
    breed_sequence = db.Column(db.Integer)  # Sequence number for breed/year
    status = db.Column(db.Enum(CowStatus), default=CowStatus.HEIFER, nullable=False, index=True)
    mother_id = db.Column(db.String(36), db.ForeignKey('cows.id'))
    photo_path = db.Column(db.String(255), nullable=True)  # Path to cow photo (JPEG format)
    current_lactation_number = db.Column(db.Integer, default=0, nullable=False, index=True)
    current_lactation_start_date = db.Column(db.Date)
    
    # Relationships
    milk_records = db.relationship('MilkRecord', backref='cow', cascade='all, delete-orphan', lazy='dynamic')
    health_records = db.relationship('HealthRecord', backref='cow', cascade='all, delete-orphan', lazy='dynamic')
    reproduction_events = db.relationship('ReproductionEvent', foreign_keys='ReproductionEvent.cow_id', backref='cow', cascade='all, delete-orphan', lazy='dynamic')
    feed_records = db.relationship('FeedRecord', backref='cow', cascade='all, delete-orphan', lazy='dynamic')
    alerts = db.relationship('Alert', backref='cow', cascade='all, delete-orphan', lazy='dynamic')
    
    # Metadata
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Cow {self.name} ({self.ear_tag})>'
    
    def to_dict(self, include_relations=False):
        """Convert cow to dictionary"""
        data = {
            'id': self.id,
            'cow_uid': self.cow_uid,
            'name': self.name,
            'ear_tag': self.ear_tag,
            'breed': self.breed.value,
            'birth_date': self.birth_date.isoformat(),
            'purchase_date': self.purchase_date.isoformat() if self.purchase_date else None,
            'breed_sequence': self.breed_sequence,
            'status': self.status.value,
            'mother_id': self.mother_id,
            'photo_path': self.photo_path,
            'photo_url': f'/api/v1/herd/cows/{self.id}/photo' if self.photo_path else None,
            'current_lactation_number': self.current_lactation_number or 0,
            'current_lactation_start_date': self.current_lactation_start_date.isoformat() if self.current_lactation_start_date else None,
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat()
        }
        
        if include_relations:
            data['milk_records'] = [r.to_dict() for r in self.milk_records]
            data['health_records'] = [r.to_dict() for r in self.health_records]
        
        return data


class MilkRecord(db.Model):
    """
    Daily milk production tracking
    Records morning and evening milk quantities
    """
    __tablename__ = 'milk_records'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cow_id = db.Column(db.String(36), db.ForeignKey('cows.id'), nullable=False, index=True)
    record_date = db.Column(db.Date, nullable=False, index=True)
    
    morning_milk = db.Column(db.Float, default=0)  # Liters
    evening_milk = db.Column(db.Float, default=0)  # Liters
    total_milk = db.Column(db.Float)  # Auto-calculated
    lactation_number = db.Column(db.Integer, default=0, nullable=False, index=True)
    
    # Quality indicators
    quality_grade = db.Column(db.String(10))  # A, B, C grade
    notes = db.Column(db.Text)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<MilkRecord {self.cow_id} {self.record_date}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'cow_id': self.cow_id,
            'record_date': self.record_date.isoformat(),
            'morning_milk': self.morning_milk,
            'evening_milk': self.evening_milk,
            'total_milk': self.total_milk,
            'lactation_number': self.lactation_number or 0,
            'quality_grade': self.quality_grade,
            'notes': self.notes
        }


class HealthRecord(db.Model):
    """
    Health monitoring and treatment tracking
    Tracks symptoms, diagnosis, and treatments
    """
    __tablename__ = 'health_records'
    
    SYMPTOMS = [
        'fever', 'mastitis', 'lameness', 'diarrhea', 
        'loss-appetite', 'discharge', 'injury', 'other'
    ]
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cow_id = db.Column(db.String(36), db.ForeignKey('cows.id'), nullable=False, index=True)
    issue_date = db.Column(db.Date, nullable=False, index=True)
    
    symptom = db.Column(db.String(50), nullable=False)
    diagnosis = db.Column(db.String(100))
    description = db.Column(db.Text)
    
    temperature = db.Column(db.Float)  # Celsius
    treatment = db.Column(db.String(100), nullable=False)
    medicine_name = db.Column(db.String(100))
    medicine_dosage = db.Column(db.String(50))
    
    veterinarian_contacted = db.Column(db.Boolean, default=False)
    veterinarian_name = db.Column(db.String(100))
    lactation_number = db.Column(db.Integer, default=0, nullable=False, index=True)
    
    recovery_status = db.Column(db.String(20))  # recovered, ongoing, relapsed
    recovery_date = db.Column(db.Date)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<HealthRecord {self.cow_id} - {self.symptom}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'cow_id': self.cow_id,
            'issue_date': self.issue_date.isoformat(),
            'symptom': self.symptom,
            'diagnosis': self.diagnosis,
            'description': self.description,
            'temperature': self.temperature,
            'treatment': self.treatment,
            'medicine_name': self.medicine_name,
            'veterinarian_contacted': self.veterinarian_contacted,
            'lactation_number': self.lactation_number or 0,
            'recovery_status': self.recovery_status
        }


class ReproductionEvent(db.Model):
    """
    Reproduction cycle tracking
    Heat detection, AI, pregnancy, calving
    """
    __tablename__ = 'reproduction_events'
    
    EVENT_TYPES = ['heat-detection', 'ai', 'pregnancy-check', 'calving', 'recheck']
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cow_id = db.Column(db.String(36), db.ForeignKey('cows.id'), nullable=False, index=True)
    event_type = db.Column(db.String(20), nullable=False, index=True)  # heat, ai, pregnancy, calving
    event_date = db.Column(db.Date, nullable=False, index=True)
    
    # Heat Detection
    heat_signs = db.Column(db.String(200))  # JSON or comma-separated
    
    # AI Details
    semen_type = db.Column(db.String(20))  # fresh, frozen
    sire_name = db.Column(db.String(100))
    sire_id = db.Column(db.String(50))
    technician_name = db.Column(db.String(100))
    
    # Pregnancy Details
    pregnancy_status = db.Column(db.String(20))  # confirmed, not-confirmed, recheck
    expected_calving_date = db.Column(db.Date)
    days_pregnant = db.Column(db.Integer)
    
    # Calving Details
    calf_gender = db.Column(db.String(10))  # male, female
    calf_weight = db.Column(db.Float)  # kg
    calf_id = db.Column(db.String(36), db.ForeignKey('cows.id'))
    calving_difficulty = db.Column(db.String(50))  # normal, assisted, surgical
    lactation_number = db.Column(db.Integer, default=0, nullable=False, index=True)
    
    notes = db.Column(db.Text)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<ReproEvent {self.cow_id} - {self.event_type}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'cow_id': self.cow_id,
            'event_type': self.event_type,
            'event_date': self.event_date.isoformat(),
            'heat_signs': self.heat_signs,
            'sire_name': self.sire_name,
            'pregnancy_status': self.pregnancy_status,
            'expected_calving_date': self.expected_calving_date.isoformat() if self.expected_calving_date else None,
            'calf_gender': self.calf_gender,
            'calf_weight': self.calf_weight,
            'lactation_number': self.lactation_number or 0,
            'notes': self.notes
        }


class FeedRecord(db.Model):
    """
    Feed management and cost tracking
    Nutrition and efficiency analysis
    """
    __tablename__ = 'feed_records'
    
    FEED_TYPES = ['hay', 'silage', 'pasture', 'concentrate', 'supplement', 'mineral']
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cow_id = db.Column(db.String(36), db.ForeignKey('cows.id'))  # NULL for herd-wide
    feed_date = db.Column(db.Date, nullable=False, index=True)
    
    feed_type = db.Column(db.String(50), nullable=False)
    quantity = db.Column(db.Float, nullable=False)  # kg
    cost_per_unit = db.Column(db.Float)  # currency per kg
    total_cost = db.Column(db.Float)
    
    supplier = db.Column(db.String(100))
    batch_number = db.Column(db.String(50))
    quality_notes = db.Column(db.Text)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<FeedRecord {self.feed_type} {self.feed_date}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'cow_id': self.cow_id,
            'feed_date': self.feed_date.isoformat(),
            'feed_type': self.feed_type,
            'quantity': self.quantity,
            'cost_per_unit': self.cost_per_unit,
            'total_cost': self.total_cost
        }


class Alert(db.Model):
    """
    Farm alerts and notifications
    Automatic alerts for reproduction, health, production
    """
    __tablename__ = 'alerts'
    
    SEVERITIES = ['critical', 'warning', 'info']
    TYPES = ['health-issue', 'heat-cycle', 'low-production', 'pregnancy-check', 'calving-prep', 
             'pregnancy-review', 'stop-milking']
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    cow_id = db.Column(db.String(36), db.ForeignKey('cows.id'), nullable=False, index=True)
    alert_type = db.Column(db.String(50), nullable=False)
    message = db.Column(db.Text, nullable=False)
    severity = db.Column(db.String(20), default='info', index=True)  # critical, warning, info
    
    acknowledged = db.Column(db.Boolean, default=False)
    acknowledged_at = db.Column(db.DateTime)
    acknowledged_by = db.Column(db.String(100))
    
    resolution_notes = db.Column(db.Text)
    resolved_at = db.Column(db.DateTime)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Alert {self.severity} - {self.alert_type}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'cow_id': self.cow_id,
            'alert_type': self.alert_type,
            'message': self.message,
            'severity': self.severity,
            'acknowledged': self.acknowledged,
            'acknowledged_at': self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            'resolution_notes': self.resolution_notes,
            'resolved_at': self.resolved_at.isoformat() if self.resolved_at else None,
            'created_at': self.created_at.isoformat()
        }


class User(db.Model):
    """
    Farm user/administrator management
    Future authentication and multi-user support
    """
    __tablename__ = 'users'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(100), unique=True, nullable=False, index=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255))
    
    full_name = db.Column(db.String(100))
    role = db.Column(db.String(20))  # admin, manager, worker
    
    is_active = db.Column(db.Boolean, default=True)
    last_login = db.Column(db.DateTime)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<User {self.username}>'


class Farm(db.Model):
    """
    Farm metadata and configuration
    Stores farm details and settings
    """
    __tablename__ = 'farms'
    
    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = db.Column(db.String(200), nullable=False)
    location = db.Column(db.String(300))
    
    total_animals = db.Column(db.Integer)
    farm_size_hectares = db.Column(db.Float)
    
    owner_name = db.Column(db.String(100))
    owner_phone = db.Column(db.String(20))
    owner_email = db.Column(db.String(120))
    
    dairy_license = db.Column(db.String(100))
    registration_number = db.Column(db.String(100))
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Farm {self.name}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'location': self.location,
            'owner_name': self.owner_name,
            'total_animals': self.total_animals
        }


class DriveConnection(db.Model):
    """
    Single-server Google Drive connection for self-hosted backups.
    """
    __tablename__ = 'drive_connections'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider = db.Column(db.String(50), nullable=False, default='google_drive', unique=True)
    google_email = db.Column(db.String(255))
    refresh_token = db.Column(db.Text)
    access_token = db.Column(db.Text)
    token_expiry = db.Column(db.DateTime)
    drive_folder_id = db.Column(db.String(255))
    drive_folder_name = db.Column(db.String(255), default='Dairy Farm Backups')
    connected_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'provider': self.provider,
            'google_email': self.google_email,
            'drive_folder_id': self.drive_folder_id,
            'drive_folder_name': self.drive_folder_name,
            'connected_at': self.connected_at.isoformat() if self.connected_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }


class BackupRecord(db.Model):
    """
    Metadata for backups stored in Google Drive.
    """
    __tablename__ = 'backup_records'

    id = db.Column(db.String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider = db.Column(db.String(50), nullable=False, default='google_drive', index=True)
    drive_file_id = db.Column(db.String(255), nullable=False, unique=True, index=True)
    file_name = db.Column(db.String(255), nullable=False)
    web_view_link = db.Column(db.String(500))
    created_time = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    size_bytes = db.Column(db.Integer)
    status = db.Column(db.String(50), nullable=False, default='completed')

    def to_dict(self):
        return {
            'id': self.id,
            'provider': self.provider,
            'drive_file_id': self.drive_file_id,
            'file_name': self.file_name,
            'web_view_link': self.web_view_link,
            'created_time': self.created_time.isoformat() if self.created_time else None,
            'size_bytes': self.size_bytes,
            'status': self.status
        }
