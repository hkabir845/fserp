from django.db import migrations


class Migration(migrations.Migration):
    """Join the invoice-stock and mill/account-protection migration branches."""

    dependencies = [
        ("api", "0179_invoice_line_stock_movement_evidence"),
        ("api", "0181_journal_line_account_protect"),
    ]

    operations = []
