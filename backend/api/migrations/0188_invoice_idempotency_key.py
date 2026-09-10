from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0187_merge_0185_employee_ledger_0186_auth_refresh"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="idempotency_key",
            field=models.CharField(
                blank=True,
                default="",
                max_length=64,
                help_text=(
                    "Client-supplied key (Idempotency-Key header) for POS / invoice create retries: "
                    "a repeat with the same key returns the original invoice instead of duplicating it."
                ),
            ),
        ),
        migrations.AddConstraint(
            model_name="invoice",
            constraint=models.UniqueConstraint(
                fields=["company", "idempotency_key"],
                condition=models.Q(idempotency_key__gt=""),
                name="invoice_company_idempotency_key_uniq",
            ),
        ),
    ]
