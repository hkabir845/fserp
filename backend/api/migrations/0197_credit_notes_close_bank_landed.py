from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0196_aquaculture_fish_sale_from_transfer_line"),
    ]

    operations = [
        migrations.AddField(
            model_name="bill",
            name="duty_total",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="bill",
            name="freight_total",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=14),
        ),
        migrations.AddField(
            model_name="bill",
            name="is_landed_cost",
            field=models.BooleanField(
                default=False,
                help_text="When true, freight and duty are added to inventory cost instead of being expensed.",
            ),
        ),
        migrations.CreateModel(
            name="CreditNote",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("credit_note_number", models.CharField(max_length=64)),
                ("credit_date", models.DateField()),
                ("status", models.CharField(default="posted", max_length=32)),
                ("reason", models.CharField(blank=True, default="", max_length=300)),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("refunded_amount", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("stock_restored", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="credit_notes", to="api.company")),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="credit_notes", to="api.customer")),
                ("invoice", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="credit_notes", to="api.invoice")),
                ("journal_entry", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="credit_notes", to="api.journalentry")),
                ("refund_journal_entry", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="credit_note_refunds", to="api.journalentry")),
            ],
            options={"db_table": "credit_note", "unique_together": {("company", "credit_note_number")}},
        ),
        migrations.CreateModel(
            name="FiscalYearClose",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("fiscal_year", models.PositiveIntegerField()),
                ("close_date", models.DateField()),
                ("net_income", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("opening_absorbed", models.DecimalField(decimal_places=2, default=0, help_text="Retained-earnings opening cleared because it already held this year's profit.", max_digits=14)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="fiscal_year_closes", to="api.company")),
                ("journal_entry", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="fiscal_year_closes", to="api.journalentry")),
            ],
            options={"db_table": "fiscal_year_close"},
        ),
        migrations.AddConstraint(
            model_name="fiscalyearclose",
            constraint=models.UniqueConstraint(fields=("company", "fiscal_year"), name="fiscal_year_close_company_year_uniq"),
        ),
        migrations.CreateModel(
            name="BankStatement",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("statement_date", models.DateField()),
                ("ending_balance", models.DecimalField(decimal_places=2, default=0, max_digits=14)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("account", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="bank_statements", to="api.chartofaccount")),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="bank_statements", to="api.company")),
            ],
            options={"db_table": "bank_statement"},
        ),
        migrations.CreateModel(
            name="BankStatementLine",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("line_date", models.DateField()),
                ("description", models.CharField(blank=True, default="", max_length=300)),
                ("amount", models.DecimalField(decimal_places=2, help_text="Signed: positive is money in, negative is money out.", max_digits=14)),
                ("matched_journal_line", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="bank_statement_lines", to="api.journalentryline")),
                ("statement", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="lines", to="api.bankstatement")),
            ],
            options={"db_table": "bank_statement_line"},
        ),
    ]
