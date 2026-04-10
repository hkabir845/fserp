from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0022_tank_dip_book_stock_before"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="date_format",
            field=models.CharField(default="YYYY-MM-DD", max_length=32),
        ),
        migrations.AddField(
            model_name="company",
            name="time_format",
            field=models.CharField(default="HH:mm", max_length=32),
        ),
    ]
