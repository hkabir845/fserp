# Generated for manual aquaculture expense GL posting (Dr expense / Cr funding account).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0121_inventory_adjustment'),
    ]

    operations = [
        migrations.AddField(
            model_name='aquacultureexpense',
            name='funding_account_code',
            field=models.CharField(
                blank=True,
                default='',
                help_text=(
                    'When set, a manual (non-inventory, non-shop-issue) pond expense auto-posts '
                    'Dr expense / Cr this funding account (e.g. 1010 Cash, 1030 Bank). '
                    'Blank keeps the row register-only (cost flows to GL via Bills or inventory instead).'
                ),
                max_length=20,
            ),
        ),
    ]
