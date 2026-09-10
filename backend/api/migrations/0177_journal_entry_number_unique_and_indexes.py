"""Give the general ledger the DB guarantees it was relying on Python to provide.

Two things were missing on ``journal_entry``:

1. **Uniqueness of (company, entry_number).** Every auto-posting path in ``gl_posting``
   guards idempotency with ``if not JournalEntry.objects.filter(entry_number=...).exists()``
   before inserting. That is check-then-insert: two concurrent requests (a double-clicked
   "Post", a client retry, a resync racing the original post) both see "not there" and both
   insert, leaving two posted journals for one document. Invoices and bills already carry
   ``unique_together`` on their numbers; the ledger did not.

2. **Indexes.** ``journal_entry`` and ``journal_entry_line`` are the largest tables in the
   system and are read by every statement, yet neither had an index on ``entry_number``,
   ``entry_date`` or ``is_posted``. The idempotency lookup above ran as a sequential scan on
   every posting.

Existing duplicates are **renamed, never deleted** — removing a journal entry would cascade
its lines and silently restate the books. A renamed row keeps its original number visible as
``<number>~DUP2`` so it can be reviewed and reversed deliberately.
"""

from django.db import migrations, models


def rename_duplicate_entry_numbers(apps, schema_editor):
    JournalEntry = apps.get_model("api", "JournalEntry")
    seen: set[tuple[int, str]] = set()
    for pk, company_id, number in (
        JournalEntry.objects.exclude(entry_number="")
        .order_by("id")
        .values_list("id", "company_id", "entry_number")
        .iterator(chunk_size=2000)
    ):
        key = (company_id, number)
        if key not in seen:
            seen.add(key)
            continue
        n = 2
        while (company_id, f"{number}~DUP{n}"[:64]) in seen:
            n += 1
        new_number = f"{number}~DUP{n}"[:64]
        JournalEntry.objects.filter(pk=pk).update(entry_number=new_number)
        seen.add((company_id, new_number))


def noop_reverse(apps, schema_editor):
    """Renaming back is not safe to automate: leave the ~DUP suffixes in place."""


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0176_vendor_purchase_terms"),
    ]

    operations = [
        migrations.RunPython(rename_duplicate_entry_numbers, noop_reverse),
        migrations.AddConstraint(
            model_name="journalentry",
            constraint=models.UniqueConstraint(
                fields=["company", "entry_number"],
                condition=models.Q(entry_number__gt=""),
                name="journal_entry_company_number_uniq",
            ),
        ),
        migrations.AddIndex(
            model_name="journalentry",
            index=models.Index(
                fields=["company", "entry_date"], name="je_company_date_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="journalentry",
            index=models.Index(
                fields=["company", "is_posted", "entry_date"],
                name="je_company_posted_date_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="journalentryline",
            index=models.Index(
                fields=["account", "journal_entry"], name="jel_account_entry_idx"
            ),
        ),
    ]
