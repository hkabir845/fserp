from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0028_password_reset_token"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="subscription_cancel_at_period_end",
            field=models.BooleanField(default=False),
        ),
    ]
