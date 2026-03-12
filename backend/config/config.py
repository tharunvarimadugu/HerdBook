"""
Configuration Management for Dairy Farm Application
Handles different environments: Development, Testing, Production
"""

import os
from datetime import timedelta


class Config:
    """Base configuration shared across all environments"""
    
    # App Settings
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    DEBUG = False
    TESTING = False
    
    # Database
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ECHO = False
    
    # JWT Settings
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY') or 'jwt-secret-key-change-in-production'
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=30)
    
    # CORS Settings
    CORS_ORIGINS = os.environ.get('CORS_ORIGINS', '*')
    
    # Upload Settings
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), '../uploads')
    
    # Logging
    LOG_LEVEL = 'INFO'
    LOG_FILE = os.path.join(os.path.dirname(__file__), '../logs/app.log')
    
    # Pagination
    ITEMS_PER_PAGE = 20
    
    # API Settings
    API_TITLE = 'Dairy Farm Management API'
    API_VERSION = 'v1'
    OPENAPI_VERSION = '3.0.2'

    # Google Drive Backup
    GOOGLE_CLIENT_ID = os.environ.get('GOOGLE_CLIENT_ID')
    GOOGLE_CLIENT_SECRET = os.environ.get('GOOGLE_CLIENT_SECRET')
    GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI')
    GOOGLE_DRIVE_FOLDER_NAME = os.environ.get('GOOGLE_DRIVE_FOLDER_NAME', 'Dairy Farm Backups')


class DevelopmentConfig(Config):
    """Development environment configuration"""
    DEBUG = True
    TESTING = False
    SQLALCHEMY_ECHO = True
    
    # SQLite for development
    SQLALCHEMY_DATABASE_URI = os.environ.get('DEV_DATABASE_URL') or os.environ.get('DATABASE_URL') or \
        f'sqlite:///{os.path.dirname(__file__)}/../database/farm.db'
    
    LOG_LEVEL = 'DEBUG'


class TestingConfig(Config):
    """Testing environment configuration"""
    TESTING = True
    DEBUG = True
    
    # In-memory SQLite for testing
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    
    # Disable CSRF for testing
    WTF_CSRF_ENABLED = False
    
    LOG_LEVEL = 'WARNING'


class ProductionConfig(Config):
    """Production environment configuration"""
    DEBUG = False
    TESTING = False
    
    # Use DATABASE_URL when provided, otherwise fall back to the project SQLite DB.
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL') or \
        f'sqlite:///{os.path.dirname(__file__)}/../database/farm.db'
    
    # Stricter security
    SESSION_COOKIE_SECURE = os.environ.get('SESSION_COOKIE_SECURE', 'false').lower() == 'true'
    SESSION_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE
    
    CORS_ORIGINS = os.environ.get('CORS_ORIGINS', '*')
    
    LOG_LEVEL = 'WARNING'


# Configuration mapping
config_by_name = {
    'development': DevelopmentConfig,
    'testing': TestingConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}


def get_config(config_name=None):
    """Get configuration object based on environment"""
    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'development')
    
    return config_by_name.get(config_name, DevelopmentConfig)
