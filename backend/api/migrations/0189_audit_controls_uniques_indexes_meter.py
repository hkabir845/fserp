"""Audit controls: financial audit trail, reference-number uniqueness, non-negative amounts.

The AddConstraint operations below fail loudly if live data already violates them, and a
migration that dies half-way through a deploy leaves the schema in an indeterminate state. So
this runs a pre-check first, in the same transaction:

* **Duplicate reference numbers** (customer / vendor / employee / item / station) are *renamed*,
  never deleted, exactly as 0177 did for journal entry numbers. The oldest row keeps the number;
  later ones become ``<number>~DUP2``, still visible for a human to reconcile.
* **Negative amounts** are NOT auto-corrected. Rewriting a stored amount would restate the books
  without anyone deciding to, so the migration stops with the offending rows named and leaves the
  call to a person. A negative invoice / bill / payment / journal line is a data question, not a
  schema question.

Verified clean against the development database before writing; the same check runs on every
target, so production cannot be surprised.
"""

from django.core.exceptions import ValidationError

import django.db.models.deletion
from django.db import migrations, models


# (model, field, max_length) — reference numbers gaining a per-company unique constraint below.
_UNIQUE_REFS = (
    ("Customer", "customer_number", 64),
    ("Vendor", "vendor_number", 64),
    ("Employee", "employee_code", 64),
    ("Item", "item_number", 64),
    ("Station", "station_number", 64),
)

# (model, [fields]) — amounts gaining a >= 0 check constraint below.
_NONNEG = (
    ("Invoice", ("total", "subtotal", "tax_total")),
    ("Bill", ("total", "subtotal", "tax_total")),
    ("Payment", ("amount",)),
    ("JournalEntryLine", ("debit", "credit")),
)


def rename_duplicate_reference_numbers(apps, schema_editor):
    """Keep the oldest row's number; suffix later collisions with ~DUP{n}. Never deletes."""
    for model_name, field, max_len in _UNIQUE_REFS:
        Model = apps.get_model("api", model_name)
        seen: set[tuple[int, str]] = set()
        rows = (
            Model.objects.exclude(**{field: ""})
            .exclude(**{f"{field}__isnull": True})
            .order_by("id")
            .values_list("id", "company_id", field)
            .iterator(chunk_size=2000)
        )
        for pk, company_id, number in rows:
            key = (company_id, number)
            if key not in seen:
                seen.add(key)
                continue
            n = 2
            while (company_id, f"{number}~DUP{n}"[:max_len]) in seen:
                n += 1
            new_number = f"{number}~DUP{n}"[:max_len]
            Model.objects.filter(pk=pk).update(**{field: new_number})
            seen.add((company_id, new_number))


def assert_no_negative_amounts(apps, schema_editor):
    """Stop the deploy with the offending rows named rather than rewriting stored money."""
    from django.db.models import Q

    offenders: list[str] = []
    for model_name, fields in _NONNEG:
        Model = apps.get_model("api", model_name)
        q = Q()
        for f in fields:
            q |= Q(**{f"{f}__lt": 0})
        bad = list(Model.objects.filter(q).order_by("id").values_list("id", flat=True)[:20])
        if bad:
            total = Model.objects.filter(q).count()
            offenders.append(
                f"  {model_name}: {total} row(s) with a negative "
                f"{'/'.join(fields)} — ids {bad}{' ...' if total > len(bad) else ''}"
            )
    if offenders:
        raise ValidationError(
            "Migration 0189 adds >= 0 check constraints, but these rows are already negative:\n"
            + "\n".join(offenders)
            + "\n\nThese are not corrected automatically: changing a stored amount restates the "
            "books. Reverse or correct each document through the app, then re-run migrate."
        )


def noop_reverse(apps, schema_editor):
    """Un-suffixing ~DUP numbers is not safe to automate: leave them for review."""


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0188_invoice_idempotency_key'),
    ]

    operations = [
        migrations.RunPython(rename_duplicate_reference_numbers, noop_reverse),
        migrations.RunPython(assert_no_negative_amounts, migrations.RunPython.noop),
        migrations.CreateModel(
            name='FinancialAuditEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(db_index=True, max_length=64)),
                ('entity_type', models.CharField(db_index=True, max_length=64)),
                ('entity_id', models.BigIntegerField(blank=True, db_index=True, null=True)),
                ('entity_ref', models.CharField(blank=True, default='', max_length=128)),
                ('reason', models.TextField(blank=True, default='')),
                ('before_json', models.JSONField(blank=True, default=dict)),
                ('after_json', models.JSONField(blank=True, default=dict)),
                ('request_meta', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
            ],
            options={
                'db_table': 'financial_audit_event',
            },
        ),
        migrations.AddField(
            model_name='meter',
            name='max_reading',
            field=models.DecimalField(blank=True, decimal_places=4, help_text='Highest display value before the register rolls to zero. Null = no rollover (open-ended totalizer).', max_digits=18, null=True),
        ),
        migrations.AlterField(
            model_name='dispenser',
            name='island',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='dispensers', to='api.island'),
        ),
        migrations.AlterField(
            model_name='employeeledgerentry',
            name='employee',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='ledger_entries', to='api.employee'),
        ),
        migrations.AlterField(
            model_name='island',
            name='station',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='islands', to='api.station'),
        ),
        migrations.AlterField(
            model_name='meter',
            name='dispenser',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='meters', to='api.dispenser'),
        ),
        migrations.AlterField(
            model_name='nozzle',
            name='meter',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='nozzles', to='api.meter'),
        ),
        migrations.AlterField(
            model_name='nozzle',
            name='product',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='nozzles', to='api.item'),
        ),
        migrations.AlterField(
            model_name='nozzle',
            name='tank',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='nozzles', to='api.tank'),
        ),
        migrations.AddIndex(
            model_name='bill',
            index=models.Index(fields=['company', 'bill_date'], name='bill_company_date_idx'),
        ),
        migrations.AddIndex(
            model_name='bill',
            index=models.Index(fields=['company', 'status', 'bill_date'], name='bill_company_status_date_idx'),
        ),
        migrations.AddIndex(
            model_name='bill',
            index=models.Index(fields=['company', 'vendor', 'bill_date'], name='bill_company_vend_date_idx'),
        ),
        migrations.AddIndex(
            model_name='invoice',
            index=models.Index(fields=['company', 'invoice_date'], name='inv_company_date_idx'),
        ),
        migrations.AddIndex(
            model_name='invoice',
            index=models.Index(fields=['company', 'status', 'invoice_date'], name='inv_company_status_date_idx'),
        ),
        migrations.AddIndex(
            model_name='invoice',
            index=models.Index(fields=['company', 'customer', 'invoice_date'], name='inv_company_cust_date_idx'),
        ),
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(fields=['company', 'payment_date'], name='pay_company_date_idx'),
        ),
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(fields=['company', 'payment_type', 'payment_date'], name='pay_company_type_date_idx'),
        ),
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(fields=['company', 'customer', 'payment_date'], name='pay_company_cust_date_idx'),
        ),
        migrations.AddIndex(
            model_name='payment',
            index=models.Index(fields=['company', 'vendor', 'payment_date'], name='pay_company_vend_date_idx'),
        ),
        migrations.AddConstraint(
            model_name='bill',
            constraint=models.CheckConstraint(condition=models.Q(('total__gte', 0), ('subtotal__gte', 0), ('tax_total__gte', 0)), name='bill_nonneg_amounts'),
        ),
        migrations.AddConstraint(
            model_name='customer',
            constraint=models.UniqueConstraint(condition=models.Q(('customer_number__gt', '')), fields=('company', 'customer_number'), name='customer_company_number_uniq'),
        ),
        migrations.AddConstraint(
            model_name='employee',
            constraint=models.UniqueConstraint(condition=models.Q(('employee_code__gt', '')), fields=('company', 'employee_code'), name='employee_company_code_uniq'),
        ),
        migrations.AddConstraint(
            model_name='invoice',
            constraint=models.CheckConstraint(condition=models.Q(('total__gte', 0), ('subtotal__gte', 0), ('tax_total__gte', 0)), name='invoice_nonneg_amounts'),
        ),
        migrations.AddConstraint(
            model_name='item',
            constraint=models.UniqueConstraint(condition=models.Q(('item_number__gt', '')), fields=('company', 'item_number'), name='item_company_number_uniq'),
        ),
        migrations.AddConstraint(
            model_name='journalentryline',
            constraint=models.CheckConstraint(condition=models.Q(('debit__gte', 0), ('credit__gte', 0)), name='jel_nonneg_debit_credit'),
        ),
        migrations.AddConstraint(
            model_name='payment',
            constraint=models.CheckConstraint(condition=models.Q(('amount__gte', 0)), name='payment_nonneg_amount'),
        ),
        migrations.AddConstraint(
            model_name='station',
            constraint=models.UniqueConstraint(condition=models.Q(('station_number__gt', '')), fields=('company', 'station_number'), name='station_company_number_uniq'),
        ),
        migrations.AddConstraint(
            model_name='vendor',
            constraint=models.UniqueConstraint(condition=models.Q(('vendor_number__gt', '')), fields=('company', 'vendor_number'), name='vendor_company_number_uniq'),
        ),
        migrations.AddField(
            model_name='financialauditevent',
            name='actor_user',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='financial_audit_events', to='api.user'),
        ),
        migrations.AddField(
            model_name='financialauditevent',
            name='company',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='financial_audit_events', to='api.company'),
        ),
        migrations.AddIndex(
            model_name='financialauditevent',
            index=models.Index(fields=['company', 'created_at'], name='fae_company_created_idx'),
        ),
        migrations.AddIndex(
            model_name='financialauditevent',
            index=models.Index(fields=['company', 'entity_type', 'entity_id'], name='fae_company_entity_idx'),
        ),
    ]
