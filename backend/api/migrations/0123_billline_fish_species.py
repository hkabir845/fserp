# Capture fish species on fish-type bill lines (fry/fingerling purchases).

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0122_aquaculture_expense_funding_account_code'),
    ]

    operations = [
        migrations.AddField(
            model_name='billline',
            name='aquaculture_fish_species',
            field=models.CharField(
                blank=True,
                default='',
                help_text='For fish-type items: species stocked (fry/fingerling), e.g. tilapia, rui, pangas.',
                max_length=64,
            ),
        ),
        migrations.AddField(
            model_name='billline',
            name='aquaculture_fish_species_other',
            field=models.CharField(
                blank=True,
                default='',
                help_text="Free-text species name when aquaculture_fish_species is 'other'.",
                max_length=120,
            ),
        ),
    ]
