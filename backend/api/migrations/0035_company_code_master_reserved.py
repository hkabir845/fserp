# Reserved FS-000001 for Master; realign other rows to FS-{id:06d} or FS-N000001.

from django.db import migrations
from django.db.models import Q

MASTER = "FS-000001"


def align_company_codes(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    master_q = Q(is_master__iexact="true") | Q(is_master="1")
    for c in Company.objects.filter(master_q).order_by("id"):
        Company.objects.filter(pk=c.pk).update(company_code=MASTER)
    for c in Company.objects.exclude(master_q).order_by("id"):
        base = f"FS-{c.id:06d}"
        code = "FS-N000001" if base == MASTER else base
        Company.objects.filter(pk=c.pk).update(company_code=code)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0034_company_company_code"),
    ]

    operations = [
        migrations.RunPython(align_company_codes, migrations.RunPython.noop),
    ]
