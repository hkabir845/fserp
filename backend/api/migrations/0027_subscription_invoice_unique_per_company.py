from collections import defaultdict

from django.db import migrations


def dedupe_subscription_invoice_numbers(apps, schema_editor):
    Inv = apps.get_model("api", "SubscriptionLedgerInvoice")
    rows = list(Inv.objects.all().order_by("id"))
    groups = defaultdict(list)
    for inv in rows:
        lo = (inv.invoice_number or "").strip().lower()
        gkey = (inv.company_id, lo if lo else None)
        groups[gkey].append(inv)

    def unique_num(company_id: int, candidate: str, pk: int) -> str:
        num = candidate[:64]
        k = 0
        while (
            Inv.objects.filter(company_id=company_id, invoice_number=num)
            .exclude(pk=pk)
            .exists()
        ):
            k += 1
            suffix = f"-{k}"
            num = (candidate[: 64 - len(suffix)] + suffix)[:64]
        return num

    for gkey, invs in groups.items():
        if gkey[1] is None:
            for inv in invs:
                base = f"SUB-{inv.company_id}-M{inv.pk}"
                new_num = unique_num(inv.company_id, base, inv.pk)
                Inv.objects.filter(pk=inv.pk).update(invoice_number=new_num)
            continue
        for i, inv in enumerate(invs):
            if i == 0:
                canon = (inv.invoice_number or "").strip().upper()[:64] or f"INV-{inv.pk}"
                new_num = unique_num(inv.company_id, canon, inv.pk)
                Inv.objects.filter(pk=inv.pk).update(invoice_number=new_num)
                continue
            base = ((invs[0].invoice_number or "INV").strip().upper()[:36] or "INV") + f"-DUP{inv.pk}"
            new_num = unique_num(inv.company_id, base, inv.pk)
            Inv.objects.filter(pk=inv.pk).update(invoice_number=new_num)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0026_saas_billing_plan_and_ledger_fields"),
    ]

    operations = [
        migrations.RunPython(dedupe_subscription_invoice_numbers, noop_reverse),
        migrations.AlterUniqueTogether(
            name="subscriptionledgerinvoice",
            unique_together={("company", "invoice_number")},
        ),
    ]
