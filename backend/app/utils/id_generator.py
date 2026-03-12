"""
Unique Cow ID Generator
Automatically generates unique cow identifiers using full breed name, birth date (DDMMYYYY), and sequence
"""

from datetime import datetime


def generate_cow_uid(breed, birth_date, db, Cow, max_retries=10):
    """Generate unique cow identifier.

    UID format: <BreedName>-<BirthDate_DDMMYYYY>-<SequenceNumber>

    This method will retry if the generated UID already exists in the database
    (to handle concurrent inserts or deleted rows).
    """
    from sqlalchemy import extract
    from sqlalchemy.exc import IntegrityError
    from app.models import BreedType

    # Normalize breed to BreedType enum
    if isinstance(breed, str):
        try:
            breed = BreedType[breed.upper()]
        except KeyError:
            breed = BreedType.MIXED

    # Get display breed name
    breed_name = breed.value.title() if breed != BreedType.MIXED else "Mixed"
    breed_name = breed_name.replace("_", "")

    # Extract birth parts
    if isinstance(birth_date, str):
        birth_date = datetime.strptime(birth_date, '%Y-%m-%d').date()

    birth_year = birth_date.year
    birth_month = birth_date.month
    birth_day = birth_date.day
    date_str = f"{str(birth_day).zfill(2)}{str(birth_month).zfill(2)}{birth_year}"  # DDMMYYYY format

    # Generate UID with incremental sequence and ensure uniqueness
    for attempt in range(1, max_retries + 1):
        # Count existing cows with same breed and birth date
        existing_same_day = Cow.query.filter(
            Cow.breed == breed,
            extract('year', Cow.birth_date) == birth_year,
            extract('month', Cow.birth_date) == birth_month,
            extract('day', Cow.birth_date) == birth_day
        ).count()

        sequence = existing_same_day + attempt
        seq_str = str(sequence).zfill(3)
        cow_uid = f"{breed_name}-{date_str}-{seq_str}"

        # Check uniqueness
        if Cow.query.filter_by(cow_uid=cow_uid).first() is None:
            return cow_uid, sequence

    raise IntegrityError(
        f"Could not generate unique cow UID after {max_retries} attempts", None, None
    )


def validate_cow_uid_unique(cow_uid, db, Cow, exclude_id=None):
    """
    Validate that a cow UID is unique in the system.
    
    Args:
        cow_uid (str): Cow UID to validate
        db (SQLAlchemy): Database instance
        Cow (Model): Cow model class
        exclude_id (str): Cow ID to exclude from check (for updates)
    
    Returns:
        bool: True if unique, False if duplicate exists
    """
    query = Cow.query.filter_by(cow_uid=cow_uid)
    
    if exclude_id:
        query = query.filter(Cow.id != exclude_id)
    
    return query.first() is None


def format_uid_display(cow_uid):
    """
    Format UID for display purposes.
    
    Args:
        cow_uid (str): Raw UID from database (format: HF-202401-001)
    
    Returns:
        dict: Formatted UID info
        {
            'full': 'HF-202401-001',
            'breed_code': 'HF',
            'year': 2024,
            'month': 1,
            'sequence': 1,
            'formatted_date': 'Jan 2024'
        }
    """
    if not cow_uid or '-' not in cow_uid:
        return {
            'full': cow_uid, 
            'breed_code': None, 
            'year_month': None,
            'year': None,
            'month': None,
            'sequence': None,
            'formatted_date': None
        }
    
    parts = cow_uid.split('-')
    if len(parts) != 3:
        return {
            'full': cow_uid, 
            'breed_code': None, 
            'year_month': None,
            'year': None,
            'month': None,
            'sequence': None,
            'formatted_date': None
        }
    
    try:
        breed_name = parts[0]
        date_str = parts[1]  # DDMMYYYY format
        sequence = int(parts[2])
        
        # Extract day, month, year from DDMMYYYY
        day = int(date_str[:2])
        month = int(date_str[2:4])
        year = int(date_str[4:])
        
        # Format month name
        month_names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        month_name = month_names[month] if 1 <= month <= 12 else 'Unknown'
        formatted_date = f"{day} {month_name} {year}"
        
        return {
            'full': cow_uid,
            'breed_code': breed_name, # Kept generic dict key for compatibility
            'year_month': date_str,
            'year': year,
            'month': month,
            'day': day,
            'sequence': sequence,
            'formatted_date': formatted_date
        }
    except (ValueError, IndexError):
        return {
            'full': cow_uid, 
            'breed_code': None, 
            'year_month': None,
            'year': None,
            'month': None,
            'sequence': None,
            'formatted_date': None
        }
