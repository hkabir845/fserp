from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0052_loan_station_backfill_invoice_station"),
    ]

    operations = [
        migrations.AlterField(
            model_name="company",
            name="station_mode",
            field=models.CharField(
                default="single",
                help_text="single = at most one active station (inactive rows allowed), default for new tenants; multi = multiple active stations.",
                max_length=16,
            ),
        ),
    ]
