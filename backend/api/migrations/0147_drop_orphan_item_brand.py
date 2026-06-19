"""Remove legacy item.brand column (not part of the Item model)."""
from django.db import migrations


def _item_has_column(cursor, column: str) -> bool:
    cursor.execute("PRAGMA table_info(item)")
    return any(row[1] == column for row in cursor.fetchall())


def drop_orphan_item_brand(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == "sqlite":
            if not _item_has_column(cursor, "brand"):
                return
            cursor.execute("ALTER TABLE item DROP COLUMN brand")
        elif connection.vendor == "postgresql":
            cursor.execute("ALTER TABLE item DROP COLUMN IF EXISTS brand")
        else:
            cursor.execute(
                """
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_name = 'item' AND column_name = 'brand'
                """
            )
            if cursor.fetchone()[0]:
                cursor.execute("ALTER TABLE item DROP COLUMN brand")


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0146_drop_orphan_item_reorder_level"),
    ]

    operations = [
        migrations.RunPython(drop_orphan_item_brand, noop_reverse),
    ]
