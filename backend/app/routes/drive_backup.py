"""
Simple Google Drive backup routes for self-hosted servers.
"""

from datetime import datetime
from urllib.parse import quote

from flask import Blueprint, redirect, request

from app.services.backup_service import BackupService, BackupValidationError
from app.services.google_drive_service import (
    DriveConfigurationError,
    DriveIntegrationError,
    GoogleDriveService,
)
from app.utils.helpers import create_error_response, create_response


drive_backup_bp = Blueprint('drive_backup', __name__, url_prefix='/api/v1/drive')


@drive_backup_bp.route('/status', methods=['GET'])
def drive_status():
    try:
        connection = GoogleDriveService.get_connection()
        return create_response({
            'configured': GoogleDriveService.is_configured(),
            'connected': bool(connection),
            'connection': connection.to_dict() if connection else None
        })
    except Exception as exc:
        return create_error_response(f'Error: {exc}', 500)


@drive_backup_bp.route('/auth/start', methods=['GET'])
def drive_auth_start():
    try:
        auth_url = GoogleDriveService.build_auth_url()
        return redirect(auth_url)
    except DriveConfigurationError as exc:
        return create_error_response(str(exc), 400)
    except Exception as exc:
        return create_error_response(f'Error: {exc}', 500)


@drive_backup_bp.route('/auth/callback', methods=['GET'])
def drive_auth_callback():
    frontend_redirect = '/?tab=profile'
    try:
        if request.args.get('error'):
            message = quote(request.args.get('error', 'OAuth failed'))
            return redirect(f'{frontend_redirect}&drive_error={message}#profile')

        code = request.args.get('code')
        state = request.args.get('state')
        if not code:
            raise DriveIntegrationError('Missing Google authorization code')

        GoogleDriveService.validate_state(state)
        tokens = GoogleDriveService.exchange_code(code)
        GoogleDriveService.save_connection(tokens)
        return redirect(f'{frontend_redirect}&drive_connected=1#profile')
    except (DriveConfigurationError, DriveIntegrationError) as exc:
        return redirect(f'{frontend_redirect}&drive_error={quote(str(exc))}#profile')
    except Exception as exc:
        return redirect(f'{frontend_redirect}&drive_error={quote(str(exc))}#profile')


@drive_backup_bp.route('/backup', methods=['POST'])
def create_drive_backup():
    try:
        timestamp = datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%SZ')
        file_name = f'dairy-farm-backup-{timestamp}.json'
        backup_bytes = BackupService.export_json_bytes()
        record = GoogleDriveService.upload_backup(file_name, backup_bytes)
        return create_response({
            'backup': record.to_dict()
        }, message='Backup uploaded to Google Drive')
    except (DriveConfigurationError, DriveIntegrationError) as exc:
        return create_error_response(str(exc), 400)
    except Exception as exc:
        return create_error_response(f'Error: {exc}', 500)


@drive_backup_bp.route('/backups', methods=['GET'])
def list_drive_backups():
    try:
        backups = [record.to_dict() for record in GoogleDriveService.list_backups()]
        return create_response({'items': backups})
    except (DriveConfigurationError, DriveIntegrationError) as exc:
        return create_error_response(str(exc), 400)
    except Exception as exc:
        return create_error_response(f'Error: {exc}', 500)


@drive_backup_bp.route('/restore/<drive_file_id>', methods=['POST'])
def restore_drive_backup(drive_file_id):
    try:
        backup_bytes = GoogleDriveService.download_backup(drive_file_id)
        result = BackupService.restore_json_bytes(backup_bytes)
        return create_response(result, message='Backup restored successfully')
    except (DriveConfigurationError, DriveIntegrationError, BackupValidationError) as exc:
        return create_error_response(str(exc), 400)
    except Exception as exc:
        return create_error_response(f'Error: {exc}', 500)


@drive_backup_bp.route('/disconnect', methods=['POST'])
def disconnect_drive():
    try:
        GoogleDriveService.disconnect()
        return create_response(message='Google Drive disconnected')
    except Exception as exc:
        return create_error_response(f'Error: {exc}', 500)
