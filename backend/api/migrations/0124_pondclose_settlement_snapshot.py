# Capture biological settlement snapshot (count/weight/bio-asset value) on pond close.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0123_billline_fish_species'),
    ]

    operations = [
        migrations.AddField(
            model_name='aquaculturedatabankpondclose',
            name='settlement_fish_count',
            field=models.IntegerField(
                blank=True,
                null=True,
                help_text='Implied remaining headcount in the pond at close (period_end).',
            ),
        ),
        migrations.AddField(
            model_name='aquaculturedatabankpondclose',
            name='settlement_weight_kg',
            field=models.DecimalField(
                blank=True,
                null=True,
                max_digits=14,
                decimal_places=4,
                help_text='Implied remaining live-fish weight (kg) in the pond at close.',
            ),
        ),
        migrations.AddField(
            model_name='aquaculturedatabankpondclose',
            name='settlement_bioasset_value',
            field=models.DecimalField(
                blank=True,
                null=True,
                max_digits=16,
                decimal_places=2,
                help_text='Bio-asset (1581) book value tagged to this pond as of period_end.',
            ),
        ),
    ]
