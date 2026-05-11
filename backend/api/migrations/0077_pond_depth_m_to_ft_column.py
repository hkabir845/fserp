# Align database column with model: some databases applied 0076 when the field was still pond_depth_m.

from django.db import migrations, models


def _rename_m_to_ft_if_needed(apps, schema_editor):
    connection = schema_editor.connection
    table = "aquaculture_pond"
    with connection.cursor() as cursor:
        if connection.vendor == "sqlite":
            cursor.execute(f'PRAGMA table_info("{table}")')
            cols = {row[1] for row in cursor.fetchall()}
            if "pond_depth_m" in cols and "pond_depth_ft" not in cols:
                cursor.execute(f'ALTER TABLE "{table}" RENAME COLUMN "pond_depth_m" TO "pond_depth_ft"')
            return
        if connection.vendor == "postgresql":
            cursor.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = %s
                """,
                [table],
            )
            cols = {row[0] for row in cursor.fetchall()}
            if "pond_depth_m" in cols and "pond_depth_ft" not in cols:
                cursor.execute(f'ALTER TABLE "{table}" RENAME COLUMN "pond_depth_m" TO "pond_depth_ft"')
            return
        # MySQL / MariaDB
        cursor.execute(
            """
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            """,
            [table],
        )
        cols = {row[0] for row in cursor.fetchall()}
        if "pond_depth_m" in cols and "pond_depth_ft" not in cols:
            cursor.execute(
                f"ALTER TABLE `{table}` CHANGE COLUMN `pond_depth_m` `pond_depth_ft` DECIMAL(10,3) NULL"
            )


def _rename_ft_to_m_if_needed(apps, schema_editor):
    connection = schema_editor.connection
    table = "aquaculture_pond"
    with connection.cursor() as cursor:
        if connection.vendor == "sqlite":
            cursor.execute(f'PRAGMA table_info("{table}")')
            cols = {row[1] for row in cursor.fetchall()}
            if "pond_depth_ft" in cols and "pond_depth_m" not in cols:
                cursor.execute(f'ALTER TABLE "{table}" RENAME COLUMN "pond_depth_ft" TO "pond_depth_m"')
            return
        if connection.vendor == "postgresql":
            cursor.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = %s
                """,
                [table],
            )
            cols = {row[0] for row in cursor.fetchall()}
            if "pond_depth_ft" in cols and "pond_depth_m" not in cols:
                cursor.execute(f'ALTER TABLE "{table}" RENAME COLUMN "pond_depth_ft" TO "pond_depth_m"')
            return
        cursor.execute(
            """
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            """,
            [table],
        )
        cols = {row[0] for row in cursor.fetchall()}
        if "pond_depth_ft" in cols and "pond_depth_m" not in cols:
            cursor.execute(
                f"ALTER TABLE `{table}` CHANGE COLUMN `pond_depth_ft` `pond_depth_m` DECIMAL(10,3) NULL"
            )


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0076_aquaculture_pond_leasing_water_depth"),
    ]

    operations = [
        migrations.RunPython(_rename_m_to_ft_if_needed, _rename_ft_to_m_if_needed),
        migrations.AlterField(
            model_name="aquaculturepond",
            name="pond_depth_ft",
            field=models.DecimalField(
                blank=True,
                decimal_places=3,
                help_text=(
                    "Representative average depth in feet — with water area (decimals) uses "
                    "435.6 sq ft per decimal for volume."
                ),
                max_digits=10,
                null=True,
            ),
        ),
    ]
