"""
Application entry point
Run with: python run.py
"""

import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app


if __name__ == '__main__':
    # Get configuration from environment
    config_name = os.environ.get('FLASK_ENV', 'production')
    
    # Create app
    app = create_app(config_name)
    
    # Run app
    debug = config_name == 'development'
    port = int(os.environ.get('PORT', 8000))
    
    app.run(
        host='0.0.0.0',
        port=port,
        debug=debug
    )
