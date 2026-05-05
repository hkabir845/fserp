# Deprecated Scripts (legacy standalone `app` package)

These scripts in the backend root imported from the removed `app` package and **will not run**. Use Django instead.

- `add_company_payment_columns.py`, `add_contract_table.py`, `add_custom_domain_fields.py`, `add_is_master_column.py`, `add_subdomain_column.py`
- `add_dummy_customers.py`, `add_infrastructure_data.py`, `add_item_images.py`, `add_missing_column.py`, `add_sample_journal_entries.py`
- `apply_invoice_patches.py`, `check_chart_of_accounts.py`, `check_cashier_data.py`, `check_sample_data.py`, `check_tanks.py`
- `comprehensive_app_check.py`, `comprehensive_system_test.py`, `copy_data_to_master.py`, `create_audit_log_table.py`
- `create_sample_contracts.py`, `create_sample_items.py`, `create_super_admin.py`, `create_tenant_companies.py`, `create_dummy_tank_dips.py`
- `debug_daily_summary.py`, `delete_last_nozzles.py`, `diagnose_login.py`, `fix_account_balances.py`, `fix_account_sign_reversals.py`
- `fix_cashier_company.py`, `fix_cashier_password.py`, `fix_database_schema.py`, `fix_empty_invoices.py`, `fix_invoice_source_enum.py`
- `fix_all_user_companies.py`, `fix_orphaned_line_items.py`, `init_database.py`, `init_comprehensive_data.py`, `init_tax_data.py`
- `investigate_account_signs.py`, `replace_item_images.py`, `replace_item_images_real.py`, `reset_admin.py`, `reset_cashiers.py`, `reset_user_password.py`
- `test_multi_tenant.py`, `test_nozzles_api.py`

**Use instead:** Django management commands (`create_superuser`, `create_default_company`), Django API, and Django migrations.
