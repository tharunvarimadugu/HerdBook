"""
Google Drive OAuth and file operations for self-hosted backups.
"""

import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import requests
from flask import current_app
from itsdangerous import BadSignature, URLSafeSerializer

from app.models import BackupRecord, DriveConnection
from database.db import db


class DriveConfigurationError(RuntimeError):
    """Raised when Google Drive settings are missing."""


class DriveIntegrationError(RuntimeError):
    """Raised when Google Drive returns an error."""


class GoogleDriveService:
    AUTH_BASE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
    TOKEN_URL = 'https://oauth2.googleapis.com/token'
    USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
    DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
    DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,webViewLink,createdTime'
    SCOPE = 'openid email https://www.googleapis.com/auth/drive.file'

    @classmethod
    def is_configured(cls):
        return bool(
            current_app.config.get('GOOGLE_CLIENT_ID')
            and current_app.config.get('GOOGLE_CLIENT_SECRET')
            and current_app.config.get('GOOGLE_REDIRECT_URI')
        )

    @classmethod
    def require_config(cls):
        if not cls.is_configured():
            raise DriveConfigurationError('Google Drive backup is not configured on this server')

    @classmethod
    def get_connection(cls):
        return DriveConnection.query.filter_by(provider='google_drive').first()

    @classmethod
    def get_serializer(cls):
        return URLSafeSerializer(current_app.config['SECRET_KEY'], salt='google-drive-oauth')

    @classmethod
    def build_auth_url(cls):
        cls.require_config()
        state = cls.get_serializer().dumps({
            'nonce': secrets.token_urlsafe(16),
            'created_at': datetime.utcnow().isoformat()
        })
        params = {
            'client_id': current_app.config['GOOGLE_CLIENT_ID'],
            'redirect_uri': current_app.config['GOOGLE_REDIRECT_URI'],
            'response_type': 'code',
            'scope': cls.SCOPE,
            'access_type': 'offline',
            'prompt': 'consent',
            'state': state
        }
        return f"{cls.AUTH_BASE_URL}?{urlencode(params)}"

    @classmethod
    def validate_state(cls, state):
        if not state:
            raise DriveIntegrationError('Missing OAuth state')
        try:
            return cls.get_serializer().loads(state)
        except BadSignature as exc:
            raise DriveIntegrationError('Invalid OAuth state') from exc

    @classmethod
    def exchange_code(cls, code):
        cls.require_config()
        response = requests.post(
            cls.TOKEN_URL,
            data={
                'client_id': current_app.config['GOOGLE_CLIENT_ID'],
                'client_secret': current_app.config['GOOGLE_CLIENT_SECRET'],
                'redirect_uri': current_app.config['GOOGLE_REDIRECT_URI'],
                'grant_type': 'authorization_code',
                'code': code
            },
            timeout=20
        )
        if not response.ok:
            raise DriveIntegrationError(f'Failed to exchange authorization code: {response.text}')
        return response.json()

    @classmethod
    def fetch_user_email(cls, access_token):
        response = requests.get(
            cls.USERINFO_URL,
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=20
        )
        if not response.ok:
            raise DriveIntegrationError('Failed to fetch Google account profile')
        payload = response.json()
        return payload.get('email')

    @classmethod
    def save_connection(cls, token_payload):
        connection = cls.get_connection() or DriveConnection(provider='google_drive')
        expires_in = int(token_payload.get('expires_in') or 3600)
        access_token = token_payload.get('access_token')
        refresh_token = token_payload.get('refresh_token') or connection.refresh_token
        if not access_token or not refresh_token:
            raise DriveIntegrationError('Google OAuth did not return the required tokens')

        connection.access_token = access_token
        connection.refresh_token = refresh_token
        connection.token_expiry = datetime.utcnow() + timedelta(seconds=expires_in - 60)
        connection.google_email = cls.fetch_user_email(access_token)
        connection.drive_folder_name = current_app.config.get('GOOGLE_DRIVE_FOLDER_NAME', 'Dairy Farm Backups')
        if not connection.connected_at:
            connection.connected_at = datetime.utcnow()

        db.session.add(connection)
        db.session.commit()
        return connection

    @classmethod
    def ensure_access_token(cls):
        connection = cls.get_connection()
        if not connection or not connection.refresh_token:
            raise DriveIntegrationError('Google Drive is not connected')

        now = datetime.utcnow()
        if connection.access_token and connection.token_expiry and connection.token_expiry > now:
            return connection, connection.access_token

        response = requests.post(
            cls.TOKEN_URL,
            data={
                'client_id': current_app.config['GOOGLE_CLIENT_ID'],
                'client_secret': current_app.config['GOOGLE_CLIENT_SECRET'],
                'refresh_token': connection.refresh_token,
                'grant_type': 'refresh_token'
            },
            timeout=20
        )
        if not response.ok:
            raise DriveIntegrationError(f'Failed to refresh Drive access token: {response.text}')

        payload = response.json()
        connection.access_token = payload.get('access_token')
        connection.token_expiry = now + timedelta(seconds=int(payload.get('expires_in') or 3600) - 60)
        db.session.add(connection)
        db.session.commit()
        return connection, connection.access_token

    @classmethod
    def ensure_backup_folder(cls, connection, access_token):
        if connection.drive_folder_id:
            return connection.drive_folder_id

        folder_name = current_app.config.get('GOOGLE_DRIVE_FOLDER_NAME', 'Dairy Farm Backups')
        response = requests.get(
            cls.DRIVE_FILES_URL,
            headers={'Authorization': f'Bearer {access_token}'},
            params={
                'q': f"mimeType = 'application/vnd.google-apps.folder' and name = '{folder_name}' and trashed = false",
                'fields': 'files(id,name)',
                'pageSize': 10
            },
            timeout=20
        )
        if not response.ok:
            raise DriveIntegrationError('Failed to list Drive folders')

        files = response.json().get('files', [])
        if files:
            folder_id = files[0]['id']
        else:
            create_response = requests.post(
                cls.DRIVE_FILES_URL,
                headers={
                    'Authorization': f'Bearer {access_token}',
                    'Content-Type': 'application/json'
                },
                json={
                    'name': folder_name,
                    'mimeType': 'application/vnd.google-apps.folder'
                },
                params={'fields': 'id,name'},
                timeout=20
            )
            if not create_response.ok:
                raise DriveIntegrationError(f'Failed to create Drive folder: {create_response.text}')
            folder_id = create_response.json()['id']

        connection.drive_folder_id = folder_id
        connection.drive_folder_name = folder_name
        db.session.add(connection)
        db.session.commit()
        return folder_id

    @classmethod
    def upload_backup(cls, file_name, file_bytes):
        cls.require_config()
        connection, access_token = cls.ensure_access_token()
        folder_id = cls.ensure_backup_folder(connection, access_token)

        boundary = f'===============codex-{secrets.token_hex(16)}=='
        metadata = json.dumps({
            'name': file_name,
            'parents': [folder_id]
        })
        body = (
            f'--{boundary}\r\n'
            'Content-Type: application/json; charset=UTF-8\r\n\r\n'
            f'{metadata}\r\n'
            f'--{boundary}\r\n'
            'Content-Type: application/json\r\n\r\n'
        ).encode('utf-8') + file_bytes + f'\r\n--{boundary}--\r\n'.encode('utf-8')

        response = requests.post(
            cls.DRIVE_UPLOAD_URL,
            headers={
                'Authorization': f'Bearer {access_token}',
                'Content-Type': f'multipart/related; boundary={boundary}'
            },
            data=body,
            timeout=60
        )
        if not response.ok:
            raise DriveIntegrationError(f'Failed to upload backup to Google Drive: {response.text}')

        payload = response.json()
        record = BackupRecord.query.filter_by(drive_file_id=payload['id']).first() or BackupRecord(
            drive_file_id=payload['id']
        )
        record.file_name = payload.get('name') or file_name
        record.web_view_link = payload.get('webViewLink')
        record.size_bytes = int(payload.get('size') or len(file_bytes))
        created_time = payload.get('createdTime')
        if created_time:
            record.created_time = datetime.fromisoformat(created_time.replace('Z', '+00:00')).astimezone(timezone.utc).replace(tzinfo=None)
        db.session.add(record)
        db.session.commit()
        return record

    @classmethod
    def list_backups(cls):
        connection = cls.get_connection()
        if not connection or not connection.drive_folder_id:
            return BackupRecord.query.order_by(BackupRecord.created_time.desc()).all()

        _, access_token = cls.ensure_access_token()
        response = requests.get(
            cls.DRIVE_FILES_URL,
            headers={'Authorization': f'Bearer {access_token}'},
            params={
                'q': f"'{connection.drive_folder_id}' in parents and trashed = false",
                'fields': 'files(id,name,size,webViewLink,createdTime)',
                'orderBy': 'createdTime desc',
                'pageSize': 50
            },
            timeout=20
        )
        if response.ok:
            for item in response.json().get('files', []):
                record = BackupRecord.query.filter_by(drive_file_id=item['id']).first() or BackupRecord(
                    drive_file_id=item['id']
                )
                record.file_name = item.get('name') or record.file_name or 'backup.json'
                record.web_view_link = item.get('webViewLink')
                record.size_bytes = int(item.get('size') or 0)
                if item.get('createdTime'):
                    record.created_time = datetime.fromisoformat(item['createdTime'].replace('Z', '+00:00')).astimezone(timezone.utc).replace(tzinfo=None)
                db.session.add(record)
            db.session.commit()

        return BackupRecord.query.order_by(BackupRecord.created_time.desc()).all()

    @classmethod
    def download_backup(cls, drive_file_id):
        _, access_token = cls.ensure_access_token()
        response = requests.get(
            f'{cls.DRIVE_FILES_URL}/{drive_file_id}',
            headers={'Authorization': f'Bearer {access_token}'},
            params={'alt': 'media'},
            timeout=60
        )
        if not response.ok:
            raise DriveIntegrationError(f'Failed to download backup from Google Drive: {response.text}')
        return response.content

    @classmethod
    def disconnect(cls):
        connection = cls.get_connection()
        if connection:
            db.session.delete(connection)
            db.session.commit()
