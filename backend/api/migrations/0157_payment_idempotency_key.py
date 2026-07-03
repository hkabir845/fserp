from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0156_aquaculture_capitalize_default_true"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment",
            name="idempotency_key",
            field=models.CharField(
                blank=True,
                default="",
                max_length=64,
                help_text=(
                    "Client-supplied key (Idempotency-Key header) to make create-payment retries safe: "
                    "a repeat with the same key returns the original payment instead of duplicating it."
                ),
            ),
        ),
        migrations.AddConstraint(
            model_name="payment",
            constraint=models.UniqueConstraint(
                fields=["company", "idempotency_key"],
                condition=models.Q(idempotency_key__gt=""),
                name="payment_company_idempotency_key_uniq",
            ),
        ),
    ]
