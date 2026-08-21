# Generated manually for pond warehouse transfer_date on all transfer forms

from django.db import migrations, models
from django.utils import timezone


def backfill_transfer_dates(apps, schema_editor):
    today = timezone.localdate()
    for model_name in (
        "PondWarehouseStockReceipt",
        "PondWarehouseStockReturn",
        "PondWarehouseInterPondTransfer",
    ):
        Model = apps.get_model("api", model_name)
        for row in Model.objects.all().only("id", "created_at").iterator():
            d = row.created_at.date() if row.created_at else today
            Model.objects.filter(pk=row.pk).update(transfer_date=d)


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0174_books_locked_through"),
    ]

    operations = [
        migrations.AddField(
            model_name="pondwarehousestockreceipt",
            name="transfer_date",
            field=models.DateField(db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="pondwarehousestockreturn",
            name="transfer_date",
            field=models.DateField(db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="pondwarehouseinterpondtransfer",
            name="transfer_date",
            field=models.DateField(db_index=True, null=True),
        ),
        migrations.RunPython(backfill_transfer_dates, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="pondwarehousestockreceipt",
            name="transfer_date",
            field=models.DateField(db_index=True),
        ),
        migrations.AlterField(
            model_name="pondwarehousestockreturn",
            name="transfer_date",
            field=models.DateField(db_index=True),
        ),
        migrations.AlterField(
            model_name="pondwarehouseinterpondtransfer",
            name="transfer_date",
            field=models.DateField(db_index=True),
        ),
        migrations.AlterModelOptions(
            name="pondwarehousestockreceipt",
            options={"ordering": ["-transfer_date", "-id"]},
        ),
        migrations.AlterModelOptions(
            name="pondwarehousestockreturn",
            options={"ordering": ["-transfer_date", "-id"]},
        ),
        migrations.AlterModelOptions(
            name="pondwarehouseinterpondtransfer",
            options={"ordering": ["-transfer_date", "-id"]},
        ),
    ]
