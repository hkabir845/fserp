"""workshop jobs and assignments

Revision ID: h3i4j5k6l7m8
Revises: g2h3i4j5k6l7
Create Date: 2026-04-21

"""
from alembic import op
import sqlalchemy as sa


revision = "h3i4j5k6l7m8"
down_revision = "g2h3i4j5k6l7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workshop_jobs",
        sa.Column("job_number", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("job_type", sa.String(), nullable=False),
        sa.Column("asset_kind", sa.String(), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=True),
        sa.Column("location_zone", sa.String(), nullable=True),
        sa.Column("facility_tag", sa.String(), nullable=True),
        sa.Column("priority", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("scheduled_start", sa.DateTime(), nullable=True),
        sa.Column("scheduled_end", sa.DateTime(), nullable=True),
        sa.Column("actual_start", sa.DateTime(), nullable=True),
        sa.Column("actual_end", sa.DateTime(), nullable=True),
        sa.Column("reported_by_user_id", sa.Integer(), nullable=True),
        sa.Column("completion_notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["reported_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "job_number", name="uq_workshop_jobs_tenant_job_number"),
    )
    op.create_index(op.f("ix_workshop_jobs_id"), "workshop_jobs", ["id"], unique=False)
    op.create_index(op.f("ix_workshop_jobs_job_number"), "workshop_jobs", ["job_number"], unique=False)
    op.create_index(op.f("ix_workshop_jobs_tenant_id"), "workshop_jobs", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_workshop_jobs_vehicle_id"), "workshop_jobs", ["vehicle_id"], unique=False)

    op.create_table(
        "workshop_job_assignments",
        sa.Column("job_id", sa.Integer(), nullable=False),
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("assigned_at", sa.DateTime(), nullable=False),
        sa.Column("released_at", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["job_id"], ["workshop_jobs.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_workshop_job_assignments_employee_id"),
        "workshop_job_assignments",
        ["employee_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workshop_job_assignments_id"), "workshop_job_assignments", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_workshop_job_assignments_job_id"), "workshop_job_assignments", ["job_id"], unique=False
    )
    op.create_index(
        op.f("ix_workshop_job_assignments_tenant_id"),
        "workshop_job_assignments",
        ["tenant_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("workshop_job_assignments")
    op.drop_table("workshop_jobs")
