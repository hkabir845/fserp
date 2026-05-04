from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0023_company_date_time_format"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="bank_account_number",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="customer",
            name="bank_name",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="customer",
            name="bank_branch",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="customer",
            name="bank_routing_number",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="vendor",
            name="bank_account_number",
            field=models.CharField(blank=True, max_length=100),
        ),
        migrations.AddField(
            model_name="vendor",
            name="bank_name",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="vendor",
            name="bank_branch",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="vendor",
            name="bank_routing_number",
            field=models.CharField(blank=True, max_length=64),
        ),
    ]
