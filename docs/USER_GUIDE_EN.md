# FSERP (Fuel Station ERP) — Complete User Guide (English)

This guide explains how to run **FSERP** day to day: filling station forecourt operations, accounting, inventory, HR, and (when licensed) **Aquaculture** on the same platform.

---

## Table of contents

1. [What FSERP is](#1-what-fserp-is)
2. [Before you start](#2-before-you-start)
3. [Login and home](#3-login-and-home)
4. [Company, station, and locale](#4-company-station-and-locale)
5. [Roles and permissions](#5-roles-and-permissions)
6. [Apps launcher and dashboard](#6-apps-launcher-and-dashboard)
7. [POS / Cashier](#7-pos--cashier)
8. [Station setup (forecourt)](#8-station-setup-forecourt)
9. [Operations (shifts and tank dips)](#9-operations-shifts-and-tank-dips)
10. [Accounting](#10-accounting)
11. [Sales, customers, and vendors](#11-sales-customers-and-vendors)
12. [Products and inventory](#12-products-and-inventory)
13. [HR and payroll](#13-hr-and-payroll)
14. [Management and settings](#14-management-and-settings)
15. [Reports and analytics](#15-reports-and-analytics)
16. [Aquaculture module](#16-aquaculture-module)
17. [Platform super-admin (SaaS)](#17-platform-super-admin-saas)
18. [Daily workflows](#18-daily-workflows)
19. [Backup and restore](#19-backup-and-restore)
20. [Troubleshooting](#20-troubleshooting)
21. [Glossary](#21-glossary)

---

## 1. What FSERP is

**FSERP** is a **Filling Station ERP**: retail fuel (wet stock), shop/c-store sales, shifts, meters, tank dips, GL, invoices, bills, payments, and optional fish-farming economics in one tenant.

**Typical users**

| Role | Use |
|------|-----|
| **Admin** | Full tenant setup, users, backup, aquaculture (when enabled) |
| **Manager** | Station ops, reports, aquaculture (when enabled) |
| **Accountant** | GL, AR/AP, journals; limited forecourt hardware menus |
| **Cashier** | POS, customers, reports |
| **Operator** | Limited POS (sales / donations) |
| **Super Admin** | Multi-tenant SaaS platform |

---

## 2. Before you start

- Use a modern browser (Chrome, Edge, Firefox). The UI is responsive on tablets/phones.
- You need the site URL, username, and password from your administrator.
- Internet is required; the app talks to the API server.
- If you belong to more than one company, pick the correct **company** before working.

---

## 3. Login and home

1. Open the site URL.
2. Enter **username** and **password**, then **Login**.
3. You land on **Apps** (`/apps`) when authenticated.
4. Use **Logout** from the sidebar/profile when finished.

**Forgot password** (`/forgot-password`): enter the email or username tied to your profile. Production needs SMTP configured; contact admin if mail does not arrive.

---

## 4. Company, station, and locale

- **Company switcher** — all lists, POS, and reports are scoped to the selected tenant.
- **Station filter** — some reports remember a selected site (browser storage). Use it for multi-site operators.
- **Currency / date format** — follows company locale settings.

---

## 5. Roles and permissions

Menus are driven by **role** and optional **permissions** (`app.sales`, `app.pos`, `app.aquaculture`, etc.).

**POS sale scope** — Cashiers may be limited to **fuel**, **general** (shop), or **both**.

**Home station** — if set on your user, POS and some reports lock to that site.

**Aquaculture** — requires company module enablement plus **Admin**, **Manager**, or a custom role with `app.aquaculture`.

---

## 6. Apps launcher and dashboard

- **Apps** (`/apps`) — tile launcher grouped by Main, Station, Operations, Accounting, Sales, Inventory, HR, Management, Reports, Aquaculture.
- **Dashboard** (`/dashboard`) — KPI snapshot and stored-data summary.

---

## 7. POS / Cashier

**Path:** `/cashier`

1. Open **POS / Cashier**.
2. Choose sale scope if shown (fuel / general).
3. Add shop lines and/or **fuel by nozzle**.
4. Verify quantity and price.
5. Complete checkout (cash, card, on-account, or split tender).

Fuel sales update **meter readings** and **tank wet stock** and post to GL when configured. Each fuel line is stored with its **nozzle** for accurate per-nozzle reporting.

---

## 8. Station setup (forecourt)

Hierarchy: **Station → Tank → Island → Dispenser → Meter → Nozzle**.

| Screen | Path |
|--------|------|
| Stations | `/stations` |
| Tanks | `/tanks` |
| Islands | `/islands` |
| Dispensers | `/dispensers` |
| Meters | `/meters` |
| Nozzles | `/nozzles` |

**New site checklist**

1. Create **Station** (`operates_fuel_retail` for forecourt sites).
2. Add **Tanks** (capacity, fuel product).
3. Add **Islands** and **Dispensers**.
4. Register **Meters** and **Nozzles** (nozzle → meter + tank + product).

Shop-only or aquaculture hub stations can set `operates_fuel_retail` off and skip forecourt assets.

---

## 9. Operations (shifts and tank dips)

| Screen | Path | Purpose |
|--------|------|---------|
| Shift Management | `/shift-management` | Open/close shifts, cash and meters |
| Tank Dips | `/tank-dips` | Physical stick readings vs book stock |

### Shifts (multi-site)

- Each **station** can have **one open shift** at a time.
- **Open:** template, station, opening cash float, optional **opening meter readings**, optional staff schedule.
- **Close:** counted cash and **closing meter readings** for reconciliation.
- **Shift summary** report shows cash variance and meter reconciliation when closing readings are captured.

### Tank dips

Record dips regularly. Variance can post to GL (inventory / shrinkage accounts). Reconcile book stock before relying on dip variance.

### Wet-stock rhythm

1. Opening dip (optional) → deliveries via **Bills** (tank on line) → POS sales → closing dip.
2. Use **Tank inventory**, **Fuel sales**, **Meter readings**, and **Shift summary** reports together.

---

## 10. Accounting

| Screen | Path |
|--------|------|
| Chart of Accounts | `/chart-of-accounts` |
| Journal Entries | `/journal-entries` |
| Fund Transfers | `/fund-transfers` |
| Loans | `/loans` |
| Bank Accounts | `/bank-accounts` |

New companies can seed the **fuel station COA template** (`fuel_station_v1`). POS, bills, payments, tank-dip variance, and payroll can auto-post journals.

---

## 11. Sales, customers, and vendors

| Screen | Path |
|--------|------|
| Customers | `/customers` |
| Vendors | `/vendors` |
| Invoices | `/invoices` |
| Bills | `/bills` |
| Payments | `/payments` |

- **Customer / vendor ledgers** — `/customers/[id]/ledger`, `/vendors/[id]/ledger`.
- Fuel **receipts**: vendor bill with `receipt_station` and **tank** on each fuel line.

---

## 12. Products and inventory

| Screen | Path |
|--------|------|
| Products & services | `/items` |
| Inventory & transfers | `/inventory` |

- **Wet stock** — tank `current_stock`; updated by bills and POS.
- **Shop stock** — per-station bins; use **Inventory transfers** between stations.

---

## 13. HR and payroll

| Screen | Path |
|--------|------|
| Employees | `/employees` |
| Payroll | `/payroll` |

Payroll can allocate net pay to aquaculture ponds when configured.

---

## 14. Management and settings

| Screen | Path |
|--------|------|
| Company | `/company` |
| Users | `/users` |
| Roles & access | `/roles` |
| Tax | `/tax` |
| Backup & Restore | `/backup` |
| Account / Password | `/account/password` |

**Aquaculture licensing** — platform super-admin sets `aquaculture_licensed`; tenant admin sets `aquaculture_enabled` in Company settings.

---

## 15. Reports and analytics

**Path:** `/reports` and `/reports/analytics`

**Fuel operations (examples)**

- Fuel sales, sales by station, **sales by nozzle**
- Tank inventory, tank dip register / variance
- Shift summary, meter readings, daily summary

**Aquaculture (when enabled)**

- Pond P&L, fish sales, pond revenue (fish + pond POS)
- Expenses, sampling, production cycles, profit transfers
- **Inter-pond fish transfers**

Filter by **company**, date range, and (where applicable) **station** or **pond**.

---

## 16. Aquaculture module

**Visibility:** module enabled on company + `app.aquaculture` (Admin/Manager or custom role).

### Menu map

| Area | Paths |
|------|-------|
| Dashboard | `/aquaculture` |
| Ponds & landlords | `/aquaculture/ponds`, `/aquaculture/landlords` |
| Production | `/aquaculture/cycles`, `/transfers`, `/stock`, `/sampling`, `/feeding` |
| Economics | `/aquaculture/sales`, `/expenses`, `/report` |

### Recommended workflow

1. **Ponds** and **landlords** (lease contracts).
2. **Production cycles** per pond/crop.
3. Stock fry via **vendor bills** (fish lines: pond, kg, head count).
4. Transfer feed/medicine: shop → **pond warehouse** — **Aquaculture → Stock → Feed & supplies → Add stock**, or **Inventory → Move to pond warehouse**. Ponds that share one physical shed (e.g. Ashari-1 and Ashari-2): create a **shared warehouse group** on that stock tab, assign both ponds under **Ponds**, then use **Move between ponds** to reallocate feed/medicine without GL.
5. **Feeding advice** — generate → approve → apply (draws warehouse, posts expense/COGS).
6. **Biomass sampling** and **mortality** on stock ledger.
7. **Inter-pond transfers** (nursing → grow-out) with optional cost allocation.
8. **Harvest sales** → finalize to invoice/GL.
9. **Pond P&L** and dashboard FCR/KPIs.

---

## 17. Platform super-admin (SaaS)

| Screen | Path |
|--------|------|
| Platform overview | `/admin/overview` |
| Companies | `/admin/companies` |
| All users | `/admin/users` |
| Subscription & billing | `/admin/subscription-billing` |

Use **Companies** to enable aquaculture license and manage tenants.

---

## 18. Daily workflows

### End of cashier shift

1. **Shift Management** — enter **closing meter readings** and counted cash; close shift.
2. Match POS / **Payments** for card and cash.
3. Post small adjustments via **Journal Entry** if needed.

### Fuel station manager (weekly)

1. Review **sales by nozzle** and **meter readings**.
2. Record **tank dips**; run **tank dip variance**.
3. Reconcile vendor fuel **bills** and tank levels.

### Aquaculture manager (weekly)

1. Apply approved **feeding**; record **mortality**.
2. Update **sampling**; review **stock** position.
3. Enter **expenses** and **sales**; run **pond P&L**.

---

## 19. Backup and restore

**Backup** (`/backup`) — download tenant export; store securely.

**Restore** — replaces tenant ERP data; confirm with typed acknowledgment. Large restores may take several minutes.

---

## 20. Troubleshooting

| Issue | Action |
|-------|--------|
| Cannot log in | Check credentials, caps lock, account active |
| 401 Unauthorized | Session expired — log in again |
| Empty lists | Wrong company selected or no data yet |
| Missing menu | Admin: update role / permissions |
| POS station locked | User `home_station` — admin verifies assignment |
| Active shift blocked | Another shift open on **same station** — close it or pick another site |
| Aquaculture missing | License + enable flags; need `app.aquaculture` permission |

---

## 21. Glossary

| Term | Meaning |
|------|---------|
| Tenant / Company | Isolated data space for one business |
| Station | Filling station site (or shop/aquaculture hub) |
| Nozzle | Pump outlet mapped to meter, tank, and fuel grade |
| Tank dip | Physical measurement of tank volume |
| Wet stock | Fuel in underground tanks |
| Shift | Cashier session with cash float and optional meter snapshots |
| AR / AP | Accounts receivable / payable |
| COA / GL | Chart of accounts / general ledger |
| FCR | Feed conversion ratio (aquaculture KPI) |

---

*Document version: aligned with FSERP menus and RBAC — 2026.*
