# Journal attribution + loan interest accrual period uniqueness.

import django.db.models.deletion
from django.db import migrations, models


def fill_loan_accrual_periods(apps, schema_editor):
    LoanInterestAccrual = apps.get_model("api", "LoanInterestAccrual")
    seen = set()
    for row in LoanInterestAccrual.objects.filter(reversed_at__isnull=True).order_by("id").iterator():
        d = row.accrual_date
        if d is None:
            continue
        key = (row.loan_id, d.year, d.month)
        if key in seen:
            continue
        seen.add(key)
        LoanInterestAccrual.objects.filter(pk=row.pk).update(
            period_year=d.year, period_month=d.month
        )
    for row in LoanInterestAccrual.objects.filter(
        reversed_at__isnull=False, period_year__isnull=True
    ).iterator():
        d = row.accrual_date
        if d is None:
            continue
        LoanInterestAccrual.objects.filter(pk=row.pk).update(
            period_year=d.year, period_month=d.month
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0182_merge_20260910_1025"),
    ]

    operations = [
        migrations.AddField(
            model_name="journalentry",
            name="created_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="journal_entries_created",
                to="api.user",
            ),
        ),
        migrations.AddField(
            model_name="journalentry",
            name="posted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="journal_entries_posted",
                to="api.user",
            ),
        ),
        migrations.AddField(
            model_name="loaninterestaccrual",
            name="period_year",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="loaninterestaccrual",
            name="period_month",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
        migrations.RunPython(fill_loan_accrual_periods, noop_reverse),
        migrations.AddConstraint(
            model_name="loaninterestaccrual",
            constraint=models.UniqueConstraint(
                condition=models.Q(
                    ("period_year__isnull", False),
                    ("reversed_at__isnull", True),
                ),
                fields=("loan", "period_year", "period_month"),
                name="loan_accrual_unreversed_period_uniq",
            ),
        ),
    ]
