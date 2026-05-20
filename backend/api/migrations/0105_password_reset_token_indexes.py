from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0104_loan_aquaculture_financing"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="passwordresettoken",
            index=models.Index(fields=["user", "used_at"], name="pwreset_user_used_idx"),
        ),
        migrations.AddIndex(
            model_name="passwordresettoken",
            index=models.Index(fields=["expires_at"], name="pwreset_expires_idx"),
        ),
    ]
