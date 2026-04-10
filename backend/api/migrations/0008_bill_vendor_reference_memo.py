from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0007_rename_coa_3000_owner_equity"),
    ]

    operations = [
        migrations.AddField(
            model_name="bill",
            name="vendor_reference",
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name="bill",
            name="memo",
            field=models.TextField(blank=True),
        ),
    ]
