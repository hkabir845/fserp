# Company Brain AI Manager — usage logs, insights, predictions, company settings

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0159_platform_brain_config"),
    ]

    operations = [
        migrations.CreateModel(
            name="BrainKnowledgeSource",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("slug", models.SlugField(max_length=64, unique=True)),
                ("title", models.CharField(max_length=200)),
                ("category", models.CharField(blank=True, default="", max_length=64)),
                ("content_bn", models.TextField(blank=True, default="")),
                ("content_en", models.TextField(blank=True, default="")),
                ("source_url", models.URLField(blank=True, default="")),
                ("is_active", models.BooleanField(default=True)),
                ("tags", models.JSONField(blank=True, default=list)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "brain_knowledge_source",
                "ordering": ["category", "title"],
            },
        ),
        migrations.CreateModel(
            name="BrainCompanySettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("brain_enabled", models.BooleanField(default=True, help_text="When false, Company Brain is disabled for this tenant.")),
                (
                    "default_advisor_mode",
                    models.CharField(
                        default="manager",
                        help_text="manager, accountant, inventory, sales, hr, ceo, risk",
                        max_length=32,
                    ),
                ),
                (
                    "monthly_token_budget",
                    models.PositiveIntegerField(
                        blank=True,
                        help_text="Optional monthly token budget; null = platform default.",
                        null=True,
                    ),
                ),
                (
                    "monthly_cost_budget_usd",
                    models.DecimalField(
                        blank=True,
                        decimal_places=4,
                        help_text="Optional monthly USD budget for AI usage.",
                        max_digits=10,
                        null=True,
                    ),
                ),
                ("allowed_models", models.JSONField(blank=True, default=list, help_text="Optional allow-list of OpenRouter model ids for this company.")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "company",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="brain_settings",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "brain_company_settings",
            },
        ),
        migrations.CreateModel(
            name="BrainUsageLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("model", models.CharField(blank=True, default="", max_length=128)),
                ("prompt_tokens", models.PositiveIntegerField(default=0)),
                ("completion_tokens", models.PositiveIntegerField(default=0)),
                ("total_tokens", models.PositiveIntegerField(default=0)),
                ("estimated_cost_usd", models.DecimalField(decimal_places=6, default=0, max_digits=12)),
                ("question_type", models.CharField(blank=True, default="", max_length=32)),
                ("route", models.CharField(blank=True, default="", max_length=64)),
                ("success", models.BooleanField(default=True)),
                ("error_message", models.TextField(blank=True, default="")),
                ("latency_ms", models.PositiveIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="brain_usage_logs",
                        to="api.company",
                    ),
                ),
                (
                    "conversation",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="usage_logs",
                        to="api.brainconversation",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="brain_usage_logs",
                        to="api.user",
                    ),
                ),
            ],
            options={
                "db_table": "brain_usage_log",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="BrainInsight",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("insight_type", models.CharField(blank=True, default="", max_length=64)),
                ("title_bn", models.CharField(max_length=300)),
                ("body_bn", models.TextField(blank=True, default="")),
                (
                    "severity",
                    models.CharField(
                        choices=[("info", "Info"), ("warning", "Warning"), ("critical", "Critical")],
                        default="info",
                        max_length=16,
                    ),
                ),
                ("key_numbers", models.JSONField(blank=True, default=dict)),
                ("recommended_action_bn", models.TextField(blank=True, default="")),
                ("confidence", models.CharField(blank=True, default="medium", max_length=16)),
                ("data_sources", models.JSONField(blank=True, default=list)),
                ("is_dismissed", models.BooleanField(default=False)),
                ("valid_until", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="brain_insights",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "brain_insight",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="BrainPrediction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("prediction_type", models.CharField(max_length=64)),
                ("title_bn", models.CharField(max_length=300)),
                ("summary_bn", models.TextField(blank=True, default="")),
                ("forecast_data", models.JSONField(blank=True, default=dict)),
                ("confidence", models.CharField(default="medium", max_length=16)),
                ("assumptions_bn", models.JSONField(blank=True, default=list)),
                ("horizon_days", models.PositiveSmallIntegerField(default=30)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="brain_predictions",
                        to="api.company",
                    ),
                ),
            ],
            options={
                "db_table": "brain_prediction",
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="BrainActionLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action_type", models.CharField(max_length=64)),
                ("description", models.TextField(blank=True, default="")),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "company",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="brain_action_logs",
                        to="api.company",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="brain_action_logs",
                        to="api.user",
                    ),
                ),
            ],
            options={
                "db_table": "brain_action_log",
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="brainusagelog",
            index=models.Index(fields=["company", "-created_at"], name="brain_usage_company_created_idx"),
        ),
        migrations.AddIndex(
            model_name="brainusagelog",
            index=models.Index(fields=["company", "created_at"], name="brain_usage_company_date_idx"),
        ),
        migrations.AddIndex(
            model_name="braininsight",
            index=models.Index(fields=["company", "-created_at"], name="brain_insight_company_created_idx"),
        ),
        migrations.AddIndex(
            model_name="braininsight",
            index=models.Index(fields=["company", "is_dismissed"], name="brain_insight_company_dismiss_idx"),
        ),
        migrations.AddIndex(
            model_name="brainprediction",
            index=models.Index(fields=["company", "-created_at"], name="brain_pred_company_created_idx"),
        ),
        migrations.AddIndex(
            model_name="brainprediction",
            index=models.Index(fields=["company", "prediction_type"], name="brain_pred_company_type_idx"),
        ),
        migrations.AddIndex(
            model_name="brainactionlog",
            index=models.Index(fields=["company", "-created_at"], name="brain_action_company_created_idx"),
        ),
    ]
