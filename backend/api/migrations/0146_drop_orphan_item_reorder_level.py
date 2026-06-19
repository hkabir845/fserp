"""Remove legacy item.reorder_level column (reorder levels belong on Tank, not Item)."""
from django.db import migrations


def _item_has_reorder_level(cursor) -> bool:
    cursor.execute("PRAGMA table_info(item)")
    return any(row[1] == "reorder_level" for row in cursor.fetchall())


def drop_orphan_item_reorder_level(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == "sqlite":
            if not _item_has_reorder_level(cursor):
                return
            cursor.execute("ALTER TABLE item DROP COLUMN reorder_level")
        elif connection.vendor == "postgresql":
            cursor.execute("ALTER TABLE item DROP COLUMN IF EXISTS reorder_level")
        else:
            cursor.execute(
                """
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_name = 'item' AND column_name = 'reorder_level'
                """
            )
            if cursor.fetchone()[0]:
                cursor.execute("ALTER TABLE item DROP COLUMN reorder_level")


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0145_pond_warehouse_stock_return"),
    ]

    operations = [
        migrations.RunPython(drop_orphan_item_reorder_level, noop_reverse),
    ]
