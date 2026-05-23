from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0112_aquaculture_pond_pl_opening"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="aquaculture_go_live_cutover_date",
            field=models.DateField(
                blank=True,
                help_text="Cutover date for aquaculture go-live: openings and biological snapshot as of this date.",
                null=True,
            ),
        ),
    ]
