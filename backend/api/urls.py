"""API URL configuration."""
from django.conf import settings
from django.http import Http404, JsonResponse
from django.urls import path

from fsms.release_info import health_payload, version_payload

from api.views import (
    auth_views,
    password_views,
    cashier_views,
    hr_views,
    companies_views,
    dashboard_views,
    broadcasts_views,
    admin_views,
    users_views,
    contracts_views,
    station_views,
    tank_views,
    item_views,
    island_views,
    dispenser_views,
    meter_views,
    nozzle_views,
    customer_views,
    vendor_views,
    chart_of_accounts_views,
    bank_accounts_views,
    journal_entries_views,
    fund_transfers_views,
    invoice_views,
    bill_views,
    payment_views,
    shift_views,
    tank_dip_views,
    tax_views,
    subscription_ledger_views,
    subscription_portal_views,
    reports_views,
    loan_views,
    backup_views,
)


def api_docs(request):
    """Public endpoint list only when DEBUG=True (local). Production returns 404."""
    if not settings.DEBUG:
        raise Http404()
    return JsonResponse({
        "message": "FSMS API",
        "endpoints": [
            "/api/health/", "/api/version/",
            "/api/auth/login", "/api/auth/refresh",
            "/api/companies/current", "/api/dashboard/stats",
            "/api/admin/stats", "/api/admin/companies", "/api/admin/users",
            "/api/broadcasts/", "/api/broadcasts/my", "/api/stations/", "/api/tanks/",
            "/api/items/", "/api/islands/", "/api/dispensers/", "/api/meters/", "/api/nozzles/",
            "/api/customers/", "/api/vendors/", "/api/invoices", "/api/bills/",
            "/api/chart-of-accounts/", "/api/chart-of-accounts/templates/fuel-station/",
            "/api/chart-of-accounts/seed-template/", "/api/chart-of-accounts/backfill-descriptions/",
            "/api/bank-accounts/", "/api/journal-entries",
            "/api/fund-transfers/", "/api/payments/received/", "/api/payments/made/",
            "/api/loans/", "/api/loans/counterparties/", "/api/loans/schedule-preview/",
            "/api/payroll/",
            "/api/shifts/", "/api/tank-dips", "/api/taxes/",             "/api/reports/<id>",
            "/api/company/backup/", "/api/company/restore/",
            "/api/admin/companies/<id>/backup/", "/api/admin/companies/<id>/restore/",
            "/api/admin/companies/<id>/stations/", "/api/admin/companies/<id>/stations/<sid>/purge/",
        ],
    })


def api_root(request):
    return JsonResponse({"message": "FSMS API"})


def api_health(request):
    """Same payload as root /health, for clients that probe /api/health/."""
    return JsonResponse(health_payload())


def api_version(request):
    """Build / release metadata for automation and support (no authentication)."""
    return JsonResponse(version_payload())


urlpatterns = [
    path("docs/", api_docs),
    path("health/", api_health),
    path("health", api_health),
    path("version/", api_version),
    path("version", api_version),
    path("", api_root),
    # Auth
    path("auth/login/", auth_views.login),
    path("auth/login/form/", auth_views.login),
    path("auth/login/json/", auth_views.login),
    path("auth/refresh/", auth_views.refresh),
    path("auth/refresh", auth_views.refresh),
    path("auth/forgot-password/", password_views.forgot_password),
    path("auth/reset-password/", password_views.reset_password),
    path("auth/change-password/", password_views.change_password),
    # Companies
    path("companies/current/", companies_views.companies_current),
    path("companies/", companies_views.companies_list_or_create),
    path(
        "companies/<int:company_id>/deactivate/",
        companies_views.company_deactivate,
    ),
    path(
        "companies/<int:company_id>/activate/",
        companies_views.company_activate,
    ),
    path("companies/<int:company_id>/", companies_views.company_detail),
    path("companies/<int:company_id>", companies_views.company_detail),
    # Tenant subscription UI (Next.js /subscriptions)
    path("subscriptions/plans/", subscription_portal_views.subscriptions_plans),
    path("subscriptions/plans", subscription_portal_views.subscriptions_plans),
    path("subscriptions/my-subscription/", subscription_portal_views.subscriptions_my_subscription),
    path("subscriptions/my-subscription", subscription_portal_views.subscriptions_my_subscription),
    path("subscriptions/usage/", subscription_portal_views.subscriptions_usage),
    path("subscriptions/usage", subscription_portal_views.subscriptions_usage),
    path("subscriptions/payments/", subscription_portal_views.subscriptions_payments),
    path("subscriptions/payments", subscription_portal_views.subscriptions_payments),
    path("subscriptions/subscribe/", subscription_portal_views.subscriptions_subscribe),
    path("subscriptions/subscribe", subscription_portal_views.subscriptions_subscribe),
    path(
        "subscriptions/my-subscription/cancel/",
        subscription_portal_views.subscriptions_my_subscription_cancel,
    ),
    path(
        "subscriptions/my-subscription/cancel",
        subscription_portal_views.subscriptions_my_subscription_cancel,
    ),
    path(
        "subscriptions/my-subscription/reactivate/",
        subscription_portal_views.subscriptions_my_subscription_reactivate,
    ),
    path(
        "subscriptions/my-subscription/reactivate",
        subscription_portal_views.subscriptions_my_subscription_reactivate,
    ),
    path("company/backup/", backup_views.company_backup_download),
    path("company/restore/", backup_views.company_restore_upload),
    path("backup/constants/", backup_views.backup_restore_constants),
    # Users (Super Admin)
    path("users/", users_views.users_list_or_create),
    path("users/<int:user_id>/", users_views.user_detail),
    # Admin (Super Admin)
    path("admin/stats/", admin_views.admin_stats),
    path("admin/companies/", admin_views.admin_companies),
    path("admin/platform-release/", admin_views.admin_platform_release),
    path("admin/platform-release", admin_views.admin_platform_release),
    path(
        "admin/companies/<int:company_id>/apply-release/",
        admin_views.admin_company_apply_release,
    ),
    path(
        "admin/companies/<int:company_id>/apply-release",
        admin_views.admin_company_apply_release,
    ),
    path(
        "admin/companies/<int:company_id>/rollback-release/",
        admin_views.admin_company_rollback_release,
    ),
    path(
        "admin/companies/<int:company_id>/rollback-release",
        admin_views.admin_company_rollback_release,
    ),
    path("admin/billing-plans/", subscription_ledger_views.admin_billing_plans),
    path("admin/users/", admin_views.admin_users),
    path("admin/master-company/protection-status/", admin_views.admin_master_company_protection_status),
    path("admin/master-company/push-updates/", admin_views.admin_master_company_push_updates),
    path("admin/master-company/rollback-release/", admin_views.admin_master_company_rollback_release),
    path("admin/companies/<int:company_id>/subscription/", subscription_ledger_views.admin_company_subscription),
    path("admin/companies/<int:company_id>/subscription/extend/", subscription_ledger_views.admin_company_subscription_extend),
    path(
        "admin/companies/<int:company_id>/backup/preview/",
        backup_views.admin_company_backup_preview,
    ),
    path("admin/companies/<int:company_id>/backup/", backup_views.admin_company_backup_download),
    path("admin/companies/<int:company_id>/restore/", backup_views.admin_company_restore_upload),
    path(
        "admin/companies/<int:company_id>/stations/",
        admin_views.admin_company_stations,
    ),
    path(
        "admin/companies/<int:company_id>/stations/<int:station_id>/purge/",
        admin_views.admin_company_station_purge,
    ),
    # Contracts (Super Admin)
    path("contracts/", contracts_views.contracts_list_or_create),
    path("contracts", contracts_views.contracts_list_or_create),
    path("contracts/<int:contract_id>/", contracts_views.contract_detail),
    path("contracts/<int:contract_id>/print/", contracts_views.contract_print),
    # Dashboard
    path("dashboard/stats/", dashboard_views.dashboard_stats),
    # Broadcasts
    path("broadcasts/", broadcasts_views.broadcasts_list_or_create),
    path("broadcasts/my/", broadcasts_views.broadcasts_my),
    path("broadcasts/mark-all-applied/", broadcasts_views.broadcast_mark_all_applied),
    path("broadcasts/<int:broadcast_id>/", broadcasts_views.broadcast_detail),
    path("broadcasts/<int:broadcast_id>/read/", broadcasts_views.broadcast_read),
    path("broadcasts/<int:broadcast_id>/mark-applied/", broadcasts_views.broadcast_mark_applied),
    path("broadcasts/<int:broadcast_id>/mark-active/", broadcasts_views.broadcast_mark_active),
    # Station hierarchy
    path("stations/", station_views.stations_list_or_create),
    path("stations/<int:station_id>/", station_views.station_detail),
    path("tanks/", tank_views.tanks_list_or_create),
    path("tanks/<int:tank_id>/", tank_views.tank_detail),
    path("tanks/<int:tank_id>", tank_views.tank_detail),
    path("items/", item_views.items_list_or_create),
    path("items/<int:item_id>/", item_views.item_detail),
    path("items/<int:item_id>", item_views.item_detail),
    path("upload/items/image/", item_views.upload_item_image),
    path("islands/", island_views.islands_list_or_create),
    path("islands/<int:island_id>/", island_views.island_detail),
    path("dispensers/", dispenser_views.dispensers_list_or_create),
    path("dispensers/<int:dispenser_id>/", dispenser_views.dispenser_detail),
    path("meters/", meter_views.meters_list_or_create),
    path("meters/<int:meter_id>/", meter_views.meter_detail),
    path("meters/<int:meter_id>/reset/", meter_views.meter_reset),
    path("nozzles/", nozzle_views.nozzles_list_or_create),
    path("nozzles/details/", nozzle_views.nozzles_details),
    path("nozzles/<int:nozzle_id>/", nozzle_views.nozzle_detail),
    # Customers & Vendors
    path("customers/", customer_views.customers_list),
    path("customers/add-dummy/", customer_views.customers_add_dummy),
    path("customers/add-dummy", customer_views.customers_add_dummy),
    path("customers/<int:customer_id>/ledger/", customer_views.customer_ledger),
    path("customers/<int:customer_id>/", customer_views.customer_detail),
    path("cashier/sale/", cashier_views.cashier_sale),
    path("cashier/sale", cashier_views.cashier_sale),
    path("cashier/pos/", cashier_views.cashier_pos),
    path("cashier/pos", cashier_views.cashier_pos),
    path("vendors/", vendor_views.vendors_list_or_create),
    path("vendors/<int:vendor_id>/ledger/", vendor_views.vendor_ledger),
    path("vendors/<int:vendor_id>/", vendor_views.vendor_detail),
    # Accounting
    path("chart-of-accounts/templates/fuel-station/", chart_of_accounts_views.chart_of_accounts_template_fuel_station),
    path("chart-of-accounts/seed-template/", chart_of_accounts_views.chart_of_accounts_seed_template),
    path(
        "chart-of-accounts/backfill-descriptions/",
        chart_of_accounts_views.chart_of_accounts_backfill_descriptions,
    ),
    path("chart-of-accounts/", chart_of_accounts_views.chart_of_accounts_list_or_create),
    path("chart-of-accounts/<int:account_id>/", chart_of_accounts_views.chart_of_account_detail),
    path("chart-of-accounts/<int:account_id>/statement/", chart_of_accounts_views.chart_of_account_statement),
    path("bank-accounts/", bank_accounts_views.bank_accounts_list_or_create),
    path(
        "bank-accounts/link-unlinked-to-chart/",
        bank_accounts_views.bank_accounts_link_unlinked_to_chart,
    ),
    path("bank-accounts/<int:account_id>/", bank_accounts_views.bank_account_detail),
    path("bank-accounts/<int:account_id>/statement/", bank_accounts_views.bank_account_statement),
    path("journal-entries/", journal_entries_views.journal_entries_list_or_create),
    path("journal-entries/<int:entry_id>/", journal_entries_views.journal_entry_detail),
    path("journal-entries/<int:entry_id>/post/", journal_entries_views.journal_entry_post),
    path("journal-entries/<int:entry_id>/unpost/", journal_entries_views.journal_entry_unpost),
    path("fund-transfers/", fund_transfers_views.fund_transfers_list_or_create),
    path("fund-transfers/<int:transfer_id>/", fund_transfers_views.fund_transfer_detail),
    path("fund-transfers/<int:transfer_id>/post/", fund_transfers_views.fund_transfer_post),
    path("fund-transfers/<int:transfer_id>/unpost/", fund_transfers_views.fund_transfer_unpost),
    # Loans (borrowed / lent) — GL via JournalEntry
    path("loans/counterparties/", loan_views.loan_counterparties_list_or_create),
    path("loans/counterparties/<int:counterparty_id>/", loan_views.loan_counterparty_detail),
    path("loans/schedule-preview/", loan_views.loan_schedule_preview),
    path("loans/<int:loan_id>/schedule-remaining/", loan_views.loan_schedule_remaining),
    path("loans/<int:loan_id>/statement/", loan_views.loan_statement),
    path("loans/<int:loan_id>/interest-hint/", loan_views.loan_interest_hint),
    path("loans/<int:loan_id>/accrue-interest/", loan_views.loan_accrue_interest),
    path(
        "loans/<int:loan_id>/accruals/<int:accrual_id>/reverse/",
        loan_views.loan_accrual_reverse,
    ),
    path("loans/", loan_views.loans_list_or_create),
    path("loans", loan_views.loans_list_or_create),
    path("loans/<int:loan_id>/", loan_views.loan_detail),
    path("loans/<int:loan_id>/disburse/", loan_views.loan_disburse),
    path("loans/<int:loan_id>/repay/", loan_views.loan_repay),
    path(
        "loans/<int:loan_id>/repayments/<int:repayment_id>/reverse/",
        loan_views.loan_repayment_reverse,
    ),
    # Sales: Invoices, Bills, Payments
    path("invoices", invoice_views.invoices_list_or_create),
    path("invoices/", invoice_views.invoices_list_or_create),
    path("invoices/<int:invoice_id>/", invoice_views.invoice_detail),
    path("invoices/<int:invoice_id>/status/", invoice_views.invoice_status),
    path("bills/", bill_views.bills_list_or_create),
    path("bills/<int:bill_id>/", bill_views.bill_detail),
    path("payments/", payment_views.payments_all_list),
    path("payments/undeposited-funds/", payment_views.payments_undeposited_funds),
    path("payments/deposits/", payment_views.payments_deposits_list_or_create),
    path("payments/received/", payment_views.payments_received_list),
    path("payments/received", payment_views.payments_received_list),
    path("payments/received/outstanding/", payment_views.payments_received_outstanding),
    path("payments/made/", payment_views.payments_made_list),
    path("payments/made", payment_views.payments_made_list),
    path("payments/made/outstanding/", payment_views.payments_made_outstanding),
    path("payments/<int:payment_id>/", payment_views.payment_detail_update_delete),
    # Shifts
    path("shifts/", shift_views.shifts_list),
    path("shifts/templates/", shift_views.shift_templates_list_or_create),
    path("shifts/templates/<int:template_id>/", shift_views.shift_template_detail),
    path("shifts/sessions/active/", shift_views.shifts_sessions_active),
    path("shifts/sessions/open/", shift_views.shifts_sessions_open),
    path("shifts/sessions/<int:session_id>/close/", shift_views.shifts_sessions_close),
    # Tank dips (reconcile-all must be registered before the numeric dip_id route)
    path("tank-dips/reconcile-all/", tank_dip_views.tank_dips_reconcile_all_from_latest),
    path("tank-dips/sync-variance-gl-all/", tank_dip_views.tank_dips_sync_variance_gl_all),
    path("tank-dips/", tank_dip_views.tank_dips_list_or_create),
    path("tank-dips/<int:dip_id>/", tank_dip_views.tank_dip_detail),
    # Tax
    path("taxes/", tax_views.taxes_list_or_create),
    path("taxes/rates/", tax_views.tax_rates_create),
    path("taxes/rates/<int:rate_id>/", tax_views.tax_rate_delete),
    path("taxes/init-bangladesh/", tax_views.tax_init_bangladesh),
    path("taxes/<int:tax_id>/", tax_views.tax_detail),
    # Subscription ledger (Super Admin)
    path("subscription-ledger/invoices/", subscription_ledger_views.subscription_ledger_invoices_list_or_create),
    path("subscription-ledger/invoices/<int:invoice_id>/", subscription_ledger_views.subscription_ledger_invoice_detail),
    # Reports
    path("reports/<str:report_id>/", reports_views.report_by_id),
    # HR (employees + subledger + payroll run headers)
    path("employees/next-code/", hr_views.employee_next_code_suggested),
    path("employees/", hr_views.employees_list_or_create),
    path(
        "employees/<int:employee_id>/ledger/entries/",
        hr_views.employee_ledger_entries,
    ),
    path("employees/<int:employee_id>/ledger/", hr_views.employee_ledger),
    path("employees/<int:employee_id>/", hr_views.employee_detail),
    path("payroll/", hr_views.payroll_list_or_create),
    path("payroll/<int:payroll_id>/", hr_views.payroll_detail),
]
