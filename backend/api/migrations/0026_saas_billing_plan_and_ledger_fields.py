from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0025_bank_deposit"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="billing_plan_code",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="subscriptionledgerinvoice",
            name="billing_cycle",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="subscriptionledgerinvoice",
            name="billing_plan_code",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="subscriptionledgerinvoice",
            name="currency",
            field=models.CharField(default="BDT", max_length=3),
        ),
        migrations.AddField(
            model_name="subscriptionledgerinvoice",
            name="paid_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscriptionledgerinvoice",
            name="period_end",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscriptionledgerinvoice",
            name="period_start",
            field=models.DateField(blank=True, null=True),
        ),
    ]
