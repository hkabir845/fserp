# Bill idempotency_key + User.company FK (reuse existing users.company_id column).

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0197_credit_notes_close_bank_landed"),
    ]

    operations = [
        migrations.AddField(
            model_name="bill",
            name="idempotency_key",
            field=models.CharField(
                blank=True,
                default="",
                max_length=64,
                help_text=(
                    "Client-supplied key (Idempotency-Key header) for bill create retries: "
                    "a repeat with the same key returns the original bill instead of duplicating it."
                ),
            ),
        ),
        migrations.AddConstraint(
            model_name="bill",
            constraint=models.UniqueConstraint(
                fields=["company", "idempotency_key"],
                condition=models.Q(idempotency_key__gt=""),
                name="bill_company_idempotency_key_uniq",
            ),
        ),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="user", name="company_id"),
                migrations.AddField(
                    model_name="user",
                    name="company",
                    field=models.ForeignKey(
                        blank=True,
                        db_column="company_id",
                        help_text="Home tenant for this login. Null for platform super-admins only.",
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="users",
                        to="api.company",
                    ),
                ),
            ],
            database_operations=[
                # Null out orphan company_id values, then add FK when safe.
                migrations.RunSQL(
                    sql="""
                    UPDATE users SET company_id = NULL
                    WHERE company_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM company c WHERE c.id = users.company_id);
                    DO $$
                    BEGIN
                      IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'users_company_id_fk'
                      ) THEN
                        ALTER TABLE users
                          ADD CONSTRAINT users_company_id_fk
                          FOREIGN KEY (company_id) REFERENCES company(id)
                          ON DELETE SET NULL
                          DEFERRABLE INITIALLY DEFERRED;
                      END IF;
                    END $$;
                    """,
                    reverse_sql="""
                    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_company_id_fk;
                    """,
                ),
            ],
        ),
    ]
