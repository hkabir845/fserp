from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0008_bill_vendor_reference_memo"),
    ]

    operations = [
        migrations.AddField(
            model_name="bankaccount",
            name="is_equity_register",
            field=models.BooleanField(
                default=False,
                help_text="True for synthetic rows used only in Fund Transfer (equity chart lines). Hidden from payment bank pickers.",
            ),
        ),
    ]
