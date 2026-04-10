# Loan module (Phase 1)

## What ships now

- **Chart of Accounts** type `loan` with subtypes `loan_receivable` (you lent) and `loan_payable` (you borrowed). Balance sheet buckets receivable under assets and payable under liabilities.
- **Models**: `LoanCounterparty`, `Loan`, `LoanDisbursement`, `LoanRepayment` (company-scoped).
- **GL**: Disbursements and repayments post **posted** `JournalEntry` rows via the same `_create_posted_entry` path as invoices/payments (`AUTO-LOAN-DISP-{id}`, `AUTO-LOAN-PMT-{id}`).
- **API** (requires auth + company header like other ERP APIs):
  - `GET/POST /api/loans/counterparties/`, `GET/PUT/DELETE .../counterparties/<id>/`
  - `GET/POST /api/loans/`, `GET/PUT /api/loans/<id>/`
  - `POST /api/loans/<id>/disburse/`, `POST /api/loans/<id>/repay/`
  - `GET /api/loans/schedule-preview/?principal=&rate=&months=` (preview only; no DB row yet)
- **UI**: `/loans` — counterparties, draft loans, disburse / repay with GL posting.

## Posting rules (Phase 1)

| Event | Borrowed | Lent |
|--------|-----------|------|
| Disburse | Dr settlement (bank/cash), Cr principal (payable) | Dr principal (receivable), Cr settlement |
| Repayment | Dr principal, Dr interest (optional), Cr settlement | Dr settlement, Cr principal, Cr interest (optional) |

## Next phases (not built yet)

Accruals, stored schedules, charges, payroll recovery, intercompany mirrors, restructure/closure workflows, reports — extend the same pattern: operational rows + `loan_posting` calling shared GL helpers.
