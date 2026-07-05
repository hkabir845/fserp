"""Brain company documents + employee handover profiles."""
from __future__ import annotations

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0162_fix_brain_model_slugs"),
    ]

    operations = [
        migrations.CreateModel(
            name="BrainCompanyDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True, default="")),
                ("department", models.CharField(blank=True, default="", max_length=120)),
                ("role_tags", models.JSONField(blank=True, default=list)),
                ("file_path", models.CharField(max_length=512)),
                ("original_filename", models.CharField(blank=True, default="", max_length=255)),
                ("content_type", models.CharField(blank=True, default="", max_length=128)),
                ("file_size", models.PositiveIntegerField(default=0)),
                ("text_excerpt", models.TextField(blank=True, default="")),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="brain_documents",
                        to="api.company",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="brain_documents_uploaded",
                        to="api.user",
                    ),
                ),
            ],
            options={
                "db_table": "brain_company_document",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="EmployeeHandoverProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("job_title_snapshot", models.CharField(blank=True, default="", max_length=200)),
                ("department_snapshot", models.CharField(blank=True, default="", max_length=200)),
                (
                    "status",
                    models.CharField(
                        choices=[("draft", "Draft"), ("published", "Published")],
                        default="draft",
                        max_length=16,
                    ),
                ),
                ("erp_activity_summary", models.JSONField(blank=True, default=dict)),
                ("open_items", models.JSONField(blank=True, default=list)),
                ("week_one_plan_bn", models.JSONField(blank=True, default=list)),
                ("contacts_and_channels", models.JSONField(blank=True, default=list)),
                ("handover_notes_bn", models.TextField(blank=True, default="")),
                ("handover_notes_en", models.TextField(blank=True, default="")),
                ("is_current_for_role", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="employee_handover_profiles",
                        to="api.company",
                    ),
                ),
                (
                    "employee",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="handover_profiles",
                        to="api.employee",
                    ),
                ),
                (
                    "generated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="handover_profiles_generated",
                        to="api.user",
                    ),
                ),
                (
                    "predecessor",
                    models.ForeignKey(
                        blank=True,
                        help_text="Employee this role replaced (optional).",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="successor_handover_profiles",
                        to="api.employee",
                    ),
                ),
            ],
            options={
                "db_table": "employee_handover_profile",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.AddIndex(
            model_name="braincompanydocument",
            index=models.Index(fields=["company", "is_active", "-updated_at"], name="brain_doc_co_active_idx"),
        ),
        migrations.AddIndex(
            model_name="employeehandoverprofile",
            index=models.Index(fields=["company", "status", "-updated_at"], name="handover_co_status_idx"),
        ),
        migrations.AddIndex(
            model_name="employeehandoverprofile",
            index=models.Index(fields=["company", "employee"], name="handover_co_emp_idx"),
        ),
        migrations.AddIndex(
            model_name="employeehandoverprofile",
            index=models.Index(fields=["company", "job_title_snapshot"], name="handover_co_title_idx"),
        ),
    ]
