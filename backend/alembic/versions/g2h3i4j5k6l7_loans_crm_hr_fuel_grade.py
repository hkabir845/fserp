"""loans, crm activities, hr leave/attendance, fuel_grade on tanks, employee_code

Revision ID: g2h3i4j5k6l7
Revises: f1a2b3c4d5e6
Create Date: 2026-04-21

"""
from alembic import op
import sqlalchemy as sa


revision = "g2h3i4j5k6l7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("employees", sa.Column("employee_code", sa.String(), nullable=True))
    op.create_index(op.f("ix_employees_employee_code"), "employees", ["employee_code"], unique=False)

    op.add_column(
        "fuel_tanks",
        sa.Column("fuel_grade", sa.String(), nullable=False, server_default="diesel"),
    )
    op.create_table(
        "loans",
        sa.Column("loan_number", sa.String(), nullable=False),
        sa.Column("lender_name", sa.String(), nullable=False),
        sa.Column("reference", sa.String(), nullable=True),
        sa.Column("principal", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("annual_interest_rate_pct", sa.Numeric(precision=10, scale=4), nullable=False),
        sa.Column("start_date", sa.DateTime(), nullable=False),
        sa.Column("term_months", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("outstanding_principal", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "loan_number", name="uq_loans_tenant_loan_number"),
    )
    op.create_index(op.f("ix_loans_id"), "loans", ["id"], unique=False)
    op.create_index(op.f("ix_loans_loan_number"), "loans", ["loan_number"], unique=False)
    op.create_index(op.f("ix_loans_tenant_id"), "loans", ["tenant_id"], unique=False)

    op.create_table(
        "loan_schedule_lines",
        sa.Column("loan_id", sa.Integer(), nullable=False),
        sa.Column("installment_no", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.DateTime(), nullable=False),
        sa.Column("opening_balance", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("principal_due", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("interest_due", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("total_due", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("principal_paid", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("interest_paid", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["loan_id"], ["loans.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_loan_schedule_lines_due_date"), "loan_schedule_lines", ["due_date"], unique=False)
    op.create_index(op.f("ix_loan_schedule_lines_id"), "loan_schedule_lines", ["id"], unique=False)
    op.create_index(op.f("ix_loan_schedule_lines_loan_id"), "loan_schedule_lines", ["loan_id"], unique=False)
    op.create_index(op.f("ix_loan_schedule_lines_tenant_id"), "loan_schedule_lines", ["tenant_id"], unique=False)

    op.create_table(
        "loan_payments",
        sa.Column("loan_id", sa.Integer(), nullable=False),
        sa.Column("payment_date", sa.DateTime(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("principal_allocated", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("interest_allocated", sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["loan_id"], ["loans.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_loan_payments_id"), "loan_payments", ["id"], unique=False)
    op.create_index(op.f("ix_loan_payments_loan_id"), "loan_payments", ["loan_id"], unique=False)
    op.create_index(op.f("ix_loan_payments_payment_date"), "loan_payments", ["payment_date"], unique=False)
    op.create_index(op.f("ix_loan_payments_tenant_id"), "loan_payments", ["tenant_id"], unique=False)

    op.create_table(
        "crm_activities",
        sa.Column("lead_id", sa.Integer(), nullable=True),
        sa.Column("customer_id", sa.Integer(), nullable=True),
        sa.Column("activity_type", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("owner_user_id", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["lead_id"], ["crm_leads.id"]),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_crm_activities_customer_id"), "crm_activities", ["customer_id"], unique=False)
    op.create_index(op.f("ix_crm_activities_due_at"), "crm_activities", ["due_at"], unique=False)
    op.create_index(op.f("ix_crm_activities_id"), "crm_activities", ["id"], unique=False)
    op.create_index(op.f("ix_crm_activities_lead_id"), "crm_activities", ["lead_id"], unique=False)
    op.create_index(op.f("ix_crm_activities_tenant_id"), "crm_activities", ["tenant_id"], unique=False)

    op.create_table(
        "leave_requests",
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("leave_type", sa.String(), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decided_by_user_id", sa.Integer(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["decided_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_leave_requests_employee_id"), "leave_requests", ["employee_id"], unique=False)
    op.create_index(op.f("ix_leave_requests_end_date"), "leave_requests", ["end_date"], unique=False)
    op.create_index(op.f("ix_leave_requests_id"), "leave_requests", ["id"], unique=False)
    op.create_index(op.f("ix_leave_requests_start_date"), "leave_requests", ["start_date"], unique=False)
    op.create_index(op.f("ix_leave_requests_tenant_id"), "leave_requests", ["tenant_id"], unique=False)

    op.create_table(
        "attendance_days",
        sa.Column("employee_id", sa.Integer(), nullable=False),
        sa.Column("work_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("check_in", sa.DateTime(), nullable=True),
        sa.Column("check_out", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "employee_id", "work_date", name="uq_attendance_tenant_emp_date"),
    )
    op.create_index(op.f("ix_attendance_days_employee_id"), "attendance_days", ["employee_id"], unique=False)
    op.create_index(op.f("ix_attendance_days_id"), "attendance_days", ["id"], unique=False)
    op.create_index(op.f("ix_attendance_days_tenant_id"), "attendance_days", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_attendance_days_work_date"), "attendance_days", ["work_date"], unique=False)


def downgrade() -> None:
    op.drop_table("attendance_days")
    op.drop_table("leave_requests")
    op.drop_table("crm_activities")
    op.drop_table("loan_payments")
    op.drop_table("loan_schedule_lines")
    op.drop_table("loans")
    op.drop_column("fuel_tanks", "fuel_grade")
    op.drop_index(op.f("ix_employees_employee_code"), table_name="employees")
    op.drop_column("employees", "employee_code")
