"""
Main Flask Application Factory
"""

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
import logging
import os

from config.config import get_config
from database.db import init_db, db, migrate


def create_app(config_name=None):
    """
    Application factory function
    Creates and configures Flask app
    """
    
    # Load configuration
    config = get_config(config_name)
    
    frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../frontend'))

    # Create app
    app = Flask(__name__, static_folder=frontend_dir, static_url_path='/frontend')
    app.config.from_object(config)
    
    # Initialize database
    init_db(app)
    
    # Initialize CORS
    CORS(app, resources={
        r"/api/*": {
            "origins": config.CORS_ORIGINS,
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"],
            "supports_credentials": False
        }
    })
    
    # Configure logging
    setup_logging(app)
    
    # Register error handlers
    register_error_handlers(app)
    
    # Register blueprints
    register_blueprints(app)
    
    # Register CLI commands
    register_cli_commands(app)
    
    # Health check endpoint
    @app.route('/health', methods=['GET'])
    def health_check():
        return jsonify({'status': 'healthy', 'version': '1.0.0'}), 200
    
    # Root endpoint
    @app.route('/', methods=['GET'])
    def index():
        index_file = os.path.join(frontend_dir, 'index.html')
        if os.path.exists(index_file):
            return send_from_directory(frontend_dir, 'index.html')
        return jsonify({
            'message': 'Dairy Farm Management System API',
            'version': '1.0.0',
            'docs': '/api/docs'
        }), 200

    @app.route('/frontend/', methods=['GET'])
    def frontend_index():
        return send_from_directory(frontend_dir, 'index.html')

    @app.route('/frontend/<path:filename>', methods=['GET'])
    def frontend_assets(filename):
        return send_from_directory(frontend_dir, filename)

    @app.route('/<path:filename>', methods=['GET'])
    def site_assets(filename):
        asset_path = os.path.join(frontend_dir, filename)
        if os.path.isfile(asset_path):
            return send_from_directory(frontend_dir, filename)
        return jsonify({
            'success': False,
            'status_code': 404,
            'message': 'Resource not found'
        }), 404
    
    return app


def register_blueprints(app):
    """Register all API blueprints"""
    
    from app.routes.herd import herd_bp
    from app.routes.milk import milk_bp
    from app.routes.health import health_bp
    from app.routes.reproduction import reproduction_bp
    from app.routes.feed import feed_bp
    from app.routes.drive_backup import drive_backup_bp
    
    app.register_blueprint(herd_bp)
    app.register_blueprint(milk_bp)
    app.register_blueprint(health_bp)
    app.register_blueprint(reproduction_bp)
    app.register_blueprint(feed_bp)
    app.register_blueprint(drive_backup_bp)


def register_error_handlers(app):
    """Register error handlers"""
    
    @app.errorhandler(400)
    def bad_request(error):
        return jsonify({
            'success': False,
            'status_code': 400,
            'message': 'Bad request'
        }), 400
    
    @app.errorhandler(404)
    def not_found(error):
        return jsonify({
            'success': False,
            'status_code': 404,
            'message': 'Resource not found'
        }), 404
    
    @app.errorhandler(500)
    def internal_error(error):
        return jsonify({
            'success': False,
            'status_code': 500,
            'message': 'Internal server error'
        }), 500


def setup_logging(app):
    """Configure logging"""
    
    log_level = getattr(logging, app.config.get('LOG_LEVEL', 'INFO'))
    
    # Create logs directory if needed
    log_dir = os.path.dirname(app.config.get('LOG_FILE', 'logs/app.log'))
    if log_dir and not os.path.exists(log_dir):
        os.makedirs(log_dir)

    # Avoid adding duplicate handlers when app factory is called multiple times
    if getattr(app, '_logging_configured', False):
        app.logger.setLevel(log_level)
        return

    # File handler
    file_handler = logging.FileHandler(app.config.get('LOG_FILE', 'logs/app.log'))
    file_handler.setLevel(log_level)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(log_level)
    console_handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s'
    ))
    
    app.logger.addHandler(file_handler)
    app.logger.addHandler(console_handler)
    app.logger.setLevel(log_level)
    app._logging_configured = True


def register_cli_commands(app):
    """Register CLI commands"""
    
    @app.cli.command()
    def init_db_cli():
        """Initialize database"""
        with app.app_context():
            db.create_all()
            print('Database initialized')
    
    @app.cli.command()
    def seed_db():
        """Seed database with sample data"""
        from datetime import datetime, timedelta, date
        from app.models import Cow, CowStatus, BreedType, Farm
        
        with app.app_context():
            # Clear existing data
            db.drop_all()
            db.create_all()
            
            # Create farm
            farm = Farm(
                name='Heritage Dairy Farm',
                location='Rural Village, Country',
                owner_name='John Smith',
                owner_email='john@farm.com'
            )
            db.session.add(farm)
            
            # Create sample cows
            cows_data = [
                {
                    'name': 'Bessie-01',
                    'ear_tag': 'TAG-1001',
                    'breed': BreedType.HOLSTEIN,
                    'birth_date': date(2020, 3, 15),
                    'status': CowStatus.MILKING
                },
                {
                    'name': 'Molly-02',
                    'ear_tag': 'TAG-1002',
                    'breed': BreedType.JERSEY,
                    'birth_date': date(2021, 6, 10),
                    'status': CowStatus.PREGNANT
                },
                {
                    'name': 'Daisy-03',
                    'ear_tag': 'TAG-1003',
                    'breed': BreedType.HOLSTEIN,
                    'birth_date': date(2019, 1, 20),
                    'status': CowStatus.MILKING
                }
            ]
            
            for cow_data in cows_data:
                cow = Cow(**cow_data)
                db.session.add(cow)
            
            db.session.commit()
            print('Database seeded with sample data')
    
    @app.cli.command()
    def drop_db():
        """Drop all tables"""
        if input('Are you sure? (yes/no): ').lower() == 'yes':
            with app.app_context():
                db.drop_all()
                print('Database dropped')
