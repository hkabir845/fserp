# Company reference code FS-{id} for support and accurate lookup vs. display name.

from django.db import migrations, models


def backfill_company_codes(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    for c in Company.objects.all().order_by("id"):
        code = f"FS-{c.id:06d}"
        if getattr(c, "company_code", None) != code:
            c.company_code = code
            c.save(update_fields=["company_code"])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0033_rename_tenant_plat_company_4376c6_idx_tenant_plat_company_c92b91_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="company_code",
            field=models.CharField(blank=True, db_index=True, max_length=24, null=True, unique=True),
        ),
        migrations.RunPython(backfill_company_codes, migrations.RunPython.noop),
    ]
