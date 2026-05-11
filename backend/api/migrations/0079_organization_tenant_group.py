# Generated manually — Organization (tenant group) + Company.organization

from django.db import migrations, models
import django.db.models.deletion


def forwards_backfill_org(apps, schema_editor):
    Company = apps.get_model("api", "Company")
    Organization = apps.get_model("api", "Organization")
    for c in Company.objects.all().iterator():
        sub = (getattr(c, "subdomain", None) or "").strip() or None
        dom = (getattr(c, "custom_domain", None) or "").strip() or None
        org = Organization.objects.create(
            name=c.name,
            legal_name=getattr(c, "legal_name", "") or "",
            subdomain=sub,
            custom_domain=dom,
        )
        c.organization_id = org.id
        c.save(update_fields=["organization_id"])
    # Single source of truth: routing fields live on Organization
    Company.objects.all().update(subdomain="", custom_domain="")


def backwards_stub(apps, schema_editor):
    # Best-effort: copy org subdomain back to company (first company per org only)
    Company = apps.get_model("api", "Company")
    Organization = apps.get_model("api", "Organization")
    seen_org = set()
    for c in Company.objects.all().order_by("id").iterator():
        oid = getattr(c, "organization_id", None)
        if not oid or oid in seen_org:
            continue
        seen_org.add(oid)
        try:
            org = Organization.objects.get(pk=oid)
        except Organization.DoesNotExist:
            continue
        sub = getattr(org, "subdomain", None) or ""
        dom = getattr(org, "custom_domain", None) or ""
        Company.objects.filter(pk=c.id).update(subdomain=sub, custom_domain=dom)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0078_aquaculture_feeding_advice"),
    ]

    operations = [
        migrations.CreateModel(
            name="Organization",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=200)),
                ("legal_name", models.CharField(blank=True, max_length=200)),
                ("subdomain", models.CharField(blank=True, db_index=True, max_length=100, null=True, unique=True)),
                ("custom_domain", models.CharField(blank=True, max_length=255, null=True, unique=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True, null=True)),
            ],
            options={
                "db_table": "organization",
            },
        ),
        migrations.AddField(
            model_name="company",
            name="organization",
            field=models.ForeignKey(
                help_text="Tenant group; portal subdomain and custom domain are stored on Organization.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="companies",
                to="api.organization",
            ),
        ),
        migrations.RunPython(forwards_backfill_org, backwards_stub),
        migrations.AlterField(
            model_name="company",
            name="organization",
            field=models.ForeignKey(
                help_text="Tenant group; portal subdomain and custom domain are stored on Organization.",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="companies",
                to="api.organization",
            ),
        ),
    ]
