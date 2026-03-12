"""
Routes package initialization
"""

from app.routes.herd import herd_bp
from app.routes.milk import milk_bp
from app.routes.health import health_bp
from app.routes.reproduction import reproduction_bp
from app.routes.drive_backup import drive_backup_bp

__all__ = ['herd_bp', 'milk_bp', 'health_bp', 'reproduction_bp', 'drive_backup_bp']
