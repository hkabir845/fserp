# Multi-site: default site on customers/vendors, home site on employees, optional payroll run site, payment register site.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0046_user_home_station"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="default_station",
            field=models.ForeignKey(
                blank=True,
                help_text="Default selling / visit site for new invoices; AR register when payment is on account.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="customers_preferred_site",
                to="api.station",
            ),
        ),
        migrations.AddField(
            model_name="vendor",
            name="default_station",
            field=models.ForeignKey(
                blank=True,
                help_text="Default receiving site for new bills and vendor payment routing when not bill-specific.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="vendors_preferred_site",
                to="api.station",
            ),
        ),
        migrations.AddField(
            model_name="employee",
            name="home_station",
            field=models.ForeignKey(
                blank=True,
                help_text="Primary work site for this employee (ops / labor cost reporting).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="employees_home",
                to="api.station",
            ),
        ),
        migrations.AddField(
            model_name="payrollrun",
            name="station",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional: attribute this run to one site (management / job-cost reporting; G/L still company-level).",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payroll_runs",
                to="api.station",
            ),
        ),
        migrations.AddField(
            model_name="payment",
            name="station",
            field=models.ForeignKey(
                blank=True,
                help_text="Register / management site: derived from invoices or bills, or from party default when on account.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="payments",
                to="api.station",
            ),
        ),
    ]
