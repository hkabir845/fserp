from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0136_reassign_inactive_site_biomass_samples"),
    ]

    operations = [
        migrations.AddField(
            model_name="aquaculturepond",
            name="prior_pl_zero_confirmed_at",
            field=models.DateField(
                blank=True,
                help_text="Go-live: user confirmed no prior revenue or costs before cutover (all P&L categories zero).",
                null=True,
            ),
        ),
    ]
