# Data Bank pond close: store api.User ids (users table), not django.contrib.auth.User.

from django.db import migrations, models


def copy_user_id_columns(apps, schema_editor):
    Close = apps.get_model("api", "AquacultureDataBankPondClose")
    for row in Close.objects.all().only(
        "id",
        "closed_by_id",
        "reopened_by_id",
        "relocked_by_id",
        "closed_by_user_id",
        "reopened_by_user_id",
        "relocked_by_user_id",
    ):
        changed = []
        if row.closed_by_id and not row.closed_by_user_id:
            row.closed_by_user_id = row.closed_by_id
            changed.append("closed_by_user_id")
        if row.reopened_by_id and not row.reopened_by_user_id:
            row.reopened_by_user_id = row.reopened_by_id
            changed.append("reopened_by_user_id")
        if row.relocked_by_id and not row.relocked_by_user_id:
            row.relocked_by_user_id = row.relocked_by_id
            changed.append("relocked_by_user_id")
        if changed:
            row.save(update_fields=changed)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0107_aquaculture_data_bank_per_pond"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturedatabankpondclose",
            name="closed_by_user_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="aquaculturedatabankpondclose",
            name="reopened_by_user_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="aquaculturedatabankpondclose",
            name="relocked_by_user_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.RunPython(copy_user_id_columns, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name="aquaculturedatabankpondclose",
            name="closed_by",
        ),
        migrations.RemoveField(
            model_name="aquaculturedatabankpondclose",
            name="reopened_by",
        ),
        migrations.RemoveField(
            model_name="aquaculturedatabankpondclose",
            name="relocked_by",
        ),
    ]
