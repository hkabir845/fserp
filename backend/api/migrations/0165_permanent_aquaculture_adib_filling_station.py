# Adib Filling Station (FS-000002): Aquaculture permanently licensed + enabled.

from django.db import migrations
from django.db.models import Q


def enable_adib_aquaculture(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    Company.objects.filter(is_deleted=False).filter(
        Q(company_code__iexact="FS-000002") | Q(name__iexact="Adib Filling Station")
    ).update(aquaculture_licensed=True, aquaculture_enabled=True)


def noop_reverse(apps, schema_editor):
    # Do not revoke Aquaculture on reverse — operator may still want it on.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0164_rename_brain_action_company_created_idx_brain_actio_company_552eb9_idx_and_more"),
    ]

    operations = [
        migrations.RunPython(enable_adib_aquaculture, noop_reverse),
    ]
