"""Add photo_path column to cows table

Revision ID: photo_path_001
Revises: 
Create Date: 2024-01-10 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'photo_path_001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Add photo_path column to cows table
    op.add_column('cows', sa.Column('photo_path', sa.String(255), nullable=True))


def downgrade():
    # Remove photo_path column from cows table
    op.drop_column('cows', 'photo_path')
