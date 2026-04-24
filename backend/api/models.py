"""API models."""
import bcrypt
from decimal import Decimal

from django.db import models

from api.services.company_code import compute_company_code

# bcrypt has a 72-byte limit on password length; use same encoding everywhere
def _password_bytes(raw_password: str) -> bytes:
    return raw_password.encode("utf-8")[:72]


class Company(models.Model):
    """Company/tenant for multi-tenant support. Replaces FastAPI app.models.company."""
    # Immutable business reference: Master = FS-000001 (reserved); others FS-{id:06d}. Set in save().
    company_code = models.CharField(max_length=24, null=True, blank=True, unique=True, db_index=True)
    name = models.CharField(max_length=200)
    legal_name = models.CharField(max_length=200, blank=True)
    tax_id = models.CharField(max_length=50, blank=True)
    email = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    subdomain = models.CharField(max_length=100, blank=True)
    custom_domain = models.CharField(max_length=255, blank=True)
    currency = models.CharField(max_length=3, default="BDT")
    # Display formats for the tenant UI (see companies_views allowlists).
    date_format = models.CharField(max_length=32, default="YYYY-MM-DD")
    time_format = models.CharField(max_length=32, default="HH:mm")
    fiscal_year_start = models.CharField(max_length=5, default="01-01")
    address_line1 = models.CharField(max_length=200, blank=True)
    address_line2 = models.CharField(max_length=200, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=50, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=50, blank=True)
    is_active = models.BooleanField(default=True)
    is_master = models.CharField(max_length=10, default="false")  # "true" | "false"
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, null=True)
    # Optional fields for admin / subscription form
    contact_person = models.CharField(max_length=200, blank=True)
    payment_type = models.CharField(max_length=32, blank=True)  # monthly, quarterly, half_yearly, yearly
    payment_start_date = models.DateField(null=True, blank=True)
    payment_end_date = models.DateField(null=True, blank=True)
    payment_amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    billing_plan_code = models.CharField(max_length=32, blank=True)  # starter, growth, enterprise, platform, custom
    subscription_cancel_at_period_end = models.BooleanField(default=False)
    # Manual SaaS rollout: super admin promotes each tenant to PLATFORM_TARGET_RELEASE when ready.
    platform_release = models.CharField(max_length=64, blank=True, default="")
    platform_release_applied_at = models.DateTimeField(null=True, blank=True)
    # Set when apply_platform_release moves this company to a new tag; None = nothing to roll back.
    platform_release_previous = models.CharField(max_length=64, blank=True, null=True)

    class Meta:
        db_table = "company"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        expected = compute_company_code(company_id=self.id, is_master=getattr(self, "is_master", "false"))
        if self.company_code == expected:
            return
        Company.objects.filter(pk=self.pk).update(company_code=expected)
        self.company_code = expected

    def __str__(self):
        return self.name


class TenantPlatformReleaseEvent(models.Model):
    """
    Audit trail for platform release rollouts (SaaS): who promoted which tenant, when,
    and whether template sync or hooks ran. Used for compliance, debugging, and fleet dashboards.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="platform_release_events")
    category = models.CharField(
        max_length=32,
        db_index=True,
        help_text="master_push | apply_release | rollback_release",
    )
    server_target_release = models.CharField(max_length=64, blank=True, default="")
    success = models.BooleanField(default=True)
    error_message = models.TextField(blank=True)
    actor_user_id = models.IntegerField(null=True, blank=True)
    source = models.CharField(max_length=48, blank=True, default="")
    detail = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "tenant_platform_release_event"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["company", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.category} company={self.company_id} @ {self.created_at}"


class CompanyRole(models.Model):
    """
    Tenant-defined role template: name + permission keys (see api.services.permission_service).
    Users may optionally reference one custom_role; if set, their effective permissions
    come from that template instead of the built-in role defaults.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="custom_roles")
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=500, blank=True)
    permissions = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, null=True)

    class Meta:
        db_table = "company_role"
        unique_together = [["company", "name"]]
        ordering = ["company_id", "name"]

    def __str__(self):
        return f"{self.name} (company {self.company_id})"


class Contract(models.Model):
    """SaaS contract per company. Super Admin manages via /api/contracts/."""
    contract_number = models.CharField(max_length=64, unique=True)
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="contracts")
    contract_date = models.DateField()
    expiry_date = models.DateField()
    duration_months = models.IntegerField(null=True, blank=True)
    duration_years = models.IntegerField(null=True, blank=True)
    status = models.CharField(max_length=32, default="draft")  # draft, active, suspended, expired, cancelled, renewed
    license_type = models.CharField(max_length=64, blank=True)
    billing_period = models.CharField(max_length=32, default="monthly")  # monthly, quarterly, half_yearly, yearly
    amount_per_month = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    amount_per_year = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=3, default="BDT")
    total_contract_value = models.DecimalField(max_digits=14, decimal_places=2)
    broadcast_message = models.TextField(blank=True)
    payment_reminder_message = models.TextField(blank=True)
    terms_and_conditions = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    auto_renewal = models.CharField(max_length=10, default="false")  # "true" | "false"
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, null=True)

    class Meta:
        db_table = "contract"

    def __str__(self):
        return self.contract_number


class User(models.Model):
    username = models.CharField(max_length=255, unique=True)
    email = models.EmailField(blank=True)
    full_name = models.CharField(max_length=255, blank=True)
    role = models.CharField(max_length=64, default="user")
    custom_role = models.ForeignKey(
        CompanyRole,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_users",
    )
    password_hash = models.CharField(max_length=255, blank=True)
    company_id = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, null=True)

    class Meta:
        db_table = "users"

    def set_password(self, raw_password):
        pwd_bytes = _password_bytes(raw_password)
        self.password_hash = bcrypt.hashpw(pwd_bytes, bcrypt.gensalt()).decode("utf-8")

    def check_password(self, raw_password):
        if not self.password_hash:
            return False
        pwd_bytes = _password_bytes(raw_password)
        try:
            return bcrypt.checkpw(pwd_bytes, self.password_hash.encode("utf-8"))
        except Exception:
            return False


class PasswordResetToken(models.Model):
    """Single-use, time-limited reset link; only SHA-256 hash of the secret is stored."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="password_reset_tokens")
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "password_reset_token"


# ---------------------------------------------------------------------------
# Broadcasts (SaaS admin)
# ---------------------------------------------------------------------------
class Broadcast(models.Model):
    """Announcement from master to tenant companies."""
    company_id = models.IntegerField(null=True, blank=True)  # null = from master to all
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True)
    target = models.CharField(max_length=32, default="all")  # all, specific
    is_active = models.BooleanField(default=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "broadcast"


class BroadcastRead(models.Model):
    """Tracks which user has read which broadcast."""
    user_id = models.IntegerField()
    broadcast = models.ForeignKey(Broadcast, on_delete=models.CASCADE, related_name="reads")
    read_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "broadcast_read"
        unique_together = [["user_id", "broadcast_id"]]


# ---------------------------------------------------------------------------
# Station hierarchy (company-scoped)
# ---------------------------------------------------------------------------
class Station(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="stations")
    station_number = models.CharField(max_length=64, blank=True)
    station_name = models.CharField(max_length=200)
    address_line1 = models.CharField(max_length=300, blank=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "station"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if not self.station_number:
            self.station_number = f"STN-{self.id}"
            Station.objects.filter(pk=self.pk).update(station_number=self.station_number)


class Item(models.Model):
    """
    Products / fuels / services (company-scoped).

    item_type drives inventory and GL behavior (see api.services.item_catalog):

    - **inventory** — Perpetual stock (shop QOH and/or tanks); receipts and sales move quantity;
      COGS relieves inventory at cost when auto-GL runs.
    - **non_inventory** — Sold but not tracked as balance-sheet inventory; bills expense purchases;
      no POS stock check or automatic COGS/inventory relief from Item.cost.
    - **service** — No physical stock; revenue without inventory movement (e.g. car wash, labor).
    """
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="items")
    item_number = models.CharField(max_length=64, blank=True)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    item_type = models.CharField(max_length=32, default="inventory")  # inventory, non_inventory, service
    unit_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    quantity_on_hand = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unit = models.CharField(max_length=20, default="piece")
    pos_category = models.CharField(max_length=64, default="general")
    category = models.CharField(max_length=100, blank=True)
    barcode = models.CharField(max_length=64, blank=True)
    is_taxable = models.BooleanField(default=True)
    is_pos_available = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    image_url = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item"


class Tank(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="tanks")
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name="tanks")
    product = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="tanks")
    tank_number = models.CharField(max_length=64, blank=True)
    tank_name = models.CharField(max_length=200)
    capacity = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    current_stock = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    reorder_level = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    unit_of_measure = models.CharField(max_length=20, default="L")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tank"


class Island(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="islands")
    station = models.ForeignKey(Station, on_delete=models.CASCADE, related_name="islands")
    island_code = models.CharField(max_length=64, blank=True)
    island_name = models.CharField(max_length=200)
    location_description = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "island"


class Dispenser(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="dispensers")
    island = models.ForeignKey(Island, on_delete=models.CASCADE, related_name="dispensers")
    dispenser_code = models.CharField(max_length=64, blank=True)
    dispenser_name = models.CharField(max_length=200)
    model = models.CharField(max_length=100, blank=True)
    serial_number = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "dispenser"


class Meter(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="meters")
    dispenser = models.ForeignKey(Dispenser, on_delete=models.CASCADE, related_name="meters")
    meter_code = models.CharField(max_length=64, blank=True)
    meter_number = models.CharField(max_length=64, blank=True)
    meter_name = models.CharField(max_length=200, blank=True)
    current_reading = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    last_reset_date = models.DateTimeField(null=True, blank=True)
    reset_count = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "meter"


class Nozzle(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="nozzles")
    meter = models.ForeignKey(Meter, on_delete=models.CASCADE, related_name="nozzles")
    tank = models.ForeignKey(Tank, on_delete=models.CASCADE, related_name="nozzles")
    product = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="nozzles")
    nozzle_number = models.CharField(max_length=64, blank=True)
    nozzle_code = models.CharField(max_length=64, blank=True)
    nozzle_name = models.CharField(max_length=200, blank=True)
    color_code = models.CharField(max_length=20, default="#3B82F6")
    is_operational = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "nozzle"


# ---------------------------------------------------------------------------
# Customers & Vendors
# ---------------------------------------------------------------------------
class Customer(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="customers")
    customer_number = models.CharField(max_length=64, blank=True)
    display_name = models.CharField(max_length=200, blank=True)
    first_name = models.CharField(max_length=100, blank=True)
    company_name = models.CharField(max_length=200, blank=True)
    email = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    billing_address_line1 = models.CharField(max_length=300, blank=True)
    billing_city = models.CharField(max_length=100, blank=True)
    billing_state = models.CharField(max_length=100, blank=True)
    billing_country = models.CharField(max_length=100, blank=True)
    bank_account_number = models.CharField(max_length=100, blank=True)
    bank_name = models.CharField(max_length=200, blank=True)
    bank_branch = models.CharField(max_length=200, blank=True)
    bank_routing_number = models.CharField(max_length=64, blank=True)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_balance_date = models.DateField(null=True, blank=True)
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customer"


class Vendor(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="vendors")
    vendor_number = models.CharField(max_length=64, blank=True)
    company_name = models.CharField(max_length=200)
    display_name = models.CharField(max_length=200, blank=True)
    contact_person = models.CharField(max_length=200, blank=True)
    email = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    billing_address_line1 = models.CharField(max_length=300, blank=True)
    bank_account_number = models.CharField(max_length=100, blank=True)
    bank_name = models.CharField(max_length=200, blank=True)
    bank_branch = models.CharField(max_length=200, blank=True)
    bank_routing_number = models.CharField(max_length=64, blank=True)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_balance_date = models.DateField(null=True, blank=True)
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vendor"


class Employee(models.Model):
    """Company staff record; subledger entries track payables/advances until payroll is integrated."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="employees")
    employee_number = models.CharField(max_length=64, blank=True)
    employee_code = models.CharField(max_length=64, blank=True)
    first_name = models.CharField(max_length=100)
    last_name = models.CharField(max_length=100, blank=True)
    email = models.CharField(max_length=150, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    job_title = models.CharField(max_length=200, blank=True)
    department = models.CharField(max_length=200, blank=True)
    hire_date = models.DateField(null=True, blank=True)
    salary = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_balance_date = models.DateField(null=True, blank=True)
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employee"


class EmployeeLedgerEntry(models.Model):
    """
    Manual HR subledger: debit increases net payable to employee (e.g. accrued wages);
    credit decreases (payment to employee, advance recovery).
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="ledger_entries"
    )
    entry_date = models.DateField()
    entry_type = models.CharField(max_length=32, default="adjustment")
    reference = models.CharField(max_length=200, blank=True)
    memo = models.TextField(blank=True)
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "employee_ledger_entry"
        ordering = ["entry_date", "id"]


class PayrollRun(models.Model):
    """Pay period run; amounts default to zero until line items / GL posting exist."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="payroll_runs")
    payroll_number = models.CharField(max_length=64, blank=True)
    pay_period_start = models.DateField()
    pay_period_end = models.DateField()
    payment_date = models.DateField()
    total_gross = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_net = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    status = models.CharField(max_length=32, default="draft")
    notes = models.TextField(blank=True)
    # Posted salary payment ( Dr salary expense, Cr bank / statutory; see gl_posting.post_payroll_salary )
    salary_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payroll_runs",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payroll_run"
        ordering = ["-payment_date", "-id"]


# ---------------------------------------------------------------------------
# Accounting
# ---------------------------------------------------------------------------
class ChartOfAccount(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="chart_of_accounts")
    account_code = models.CharField(max_length=64)
    account_name = models.CharField(max_length=200)
    account_type = models.CharField(max_length=32)  # see api.services.coa_constants.CHART_ACCOUNT_TYPES
    account_sub_type = models.CharField(max_length=64, blank=True)
    description = models.TextField(blank=True)
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children")
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_balance_date = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "chart_of_account"
        unique_together = [["company", "account_code"]]


class BankAccount(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="bank_accounts")
    chart_account = models.ForeignKey(ChartOfAccount, null=True, blank=True, on_delete=models.SET_NULL, related_name="bank_accounts")
    account_name = models.CharField(max_length=200)
    account_number = models.CharField(max_length=64)
    bank_name = models.CharField(max_length=200)
    account_type = models.CharField(max_length=32, default="CHECKING")
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_balance_date = models.DateField(null=True, blank=True)
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    is_equity_register = models.BooleanField(
        default=False,
        help_text=(
            "True for synthetic rows used only in Fund Transfer (equity chart lines). "
            "Hidden from payment bank pickers."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "bank_account"


class BankDeposit(models.Model):
    """
    Batch deposit of customer receipts from clearing accounts (cash / undeposited / card)
    into a bank register. Mirrors common ERP “Record deposits” workflows (e.g. undeposited → bank).
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="bank_deposits")
    deposit_number = models.CharField(max_length=64, blank=True)
    bank_account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT, related_name="bank_deposits"
    )
    deposit_date = models.DateField()
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    memo = models.TextField(blank=True)
    is_reconciled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "bank_deposit"
        ordering = ["-deposit_date", "-id"]


class JournalEntry(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="journal_entries")
    entry_number = models.CharField(max_length=64, blank=True)
    entry_date = models.DateField()
    description = models.TextField(blank=True)
    is_posted = models.BooleanField(default=False)
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journal_entry"


class JournalEntryLine(models.Model):
    journal_entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="lines")
    account = models.ForeignKey(ChartOfAccount, on_delete=models.CASCADE, related_name="journal_lines")
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    description = models.CharField(max_length=300, blank=True)

    class Meta:
        db_table = "journal_entry_line"


class FundTransfer(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="fund_transfers")
    from_bank = models.ForeignKey(BankAccount, on_delete=models.CASCADE, related_name="transfers_out")
    to_bank = models.ForeignKey(BankAccount, on_delete=models.CASCADE, related_name="transfers_in")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    transfer_date = models.DateField()
    reference = models.CharField(max_length=200, blank=True)
    is_posted = models.BooleanField(default=False)
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "fund_transfer"


# ---------------------------------------------------------------------------
# Sales: Invoices, Bills, Payments
# ---------------------------------------------------------------------------
class Invoice(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="invoices")
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="invoices")
    shift_session = models.ForeignKey(
        "ShiftSession",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoices",
    )
    invoice_number = models.CharField(max_length=64)
    invoice_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=32, default="draft")  # draft, sent, paid, partial, overdue
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=32, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "invoice"
        unique_together = [["company", "invoice_number"]]


class InvoiceLine(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL, related_name="invoice_lines")
    description = models.CharField(max_length=300, blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=4, default=1)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = "invoice_line"


class Bill(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="bills")
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name="bills")
    bill_number = models.CharField(max_length=64)
    bill_date = models.DateField()
    due_date = models.DateField(null=True, blank=True)
    vendor_reference = models.CharField(max_length=200, blank=True)
    memo = models.TextField(blank=True)
    status = models.CharField(max_length=32, default="draft")
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    tax_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    stock_receipt_applied = models.BooleanField(
        default=False,
        help_text="Set when inventory receipt from this bill has been applied (tank + QOH).",
    )
    vendor_ap_incremented = models.BooleanField(
        default=False,
        help_text="True once this bill's total was added to vendor.current_balance (A/P subledger).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "bill"
        unique_together = [["company", "bill_number"]]


class BillLine(models.Model):
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE, related_name="lines")
    item = models.ForeignKey(Item, null=True, blank=True, on_delete=models.SET_NULL, related_name="bill_lines")
    tank = models.ForeignKey(
        "Tank",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bill_lines",
        help_text="When set, fuel/inventory receipt posts into this tank (must match line item).",
    )
    description = models.CharField(max_length=300, blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=4, default=1)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        db_table = "bill_line"


class Payment(models.Model):
    PAYMENT_TYPE_RECEIVED = "received"
    PAYMENT_TYPE_MADE = "made"
    PAYMENT_TYPE_DEPOSIT = "deposit"
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="payments")
    payment_type = models.CharField(max_length=32)  # received, made, deposit
    customer = models.ForeignKey(Customer, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")
    vendor = models.ForeignKey(Vendor, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")
    bank_account = models.ForeignKey(BankAccount, null=True, blank=True, on_delete=models.SET_NULL, related_name="payments")
    bank_deposit = models.ForeignKey(
        "BankDeposit",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="deposit_payments",
        help_text="When set, this receipt was included in a batch bank deposit (undeposited → bank).",
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_date = models.DateField()
    payment_method = models.CharField(
        max_length=32,
        blank=True,
        default="",
        help_text="check, ach, cash, etc. (payments made/received UI)",
    )
    reference = models.CharField(max_length=200, blank=True)
    memo = models.TextField(blank=True)
    vendor_ap_decremented = models.BooleanField(
        default=False,
        help_text="For payments made: True once amount was subtracted from vendor.current_balance.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "payment"


class PaymentInvoiceAllocation(models.Model):
    """Apply a customer payment to one or more open invoices (subledger + reconciliation)."""

    payment = models.ForeignKey(
        Payment, on_delete=models.CASCADE, related_name="invoice_allocations"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, related_name="payment_allocations"
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "payment_invoice_allocation"
        unique_together = [["payment", "invoice"]]


class PaymentBillAllocation(models.Model):
    """Apply a vendor payment to one or more open bills."""

    payment = models.ForeignKey(
        Payment, on_delete=models.CASCADE, related_name="bill_allocations"
    )
    bill = models.ForeignKey("Bill", on_delete=models.CASCADE, related_name="payment_allocations")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "payment_bill_allocation"
        unique_together = [["payment", "bill"]]


# ---------------------------------------------------------------------------
# Operations: Shifts, Tank dips
# ---------------------------------------------------------------------------
class ShiftTemplate(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="shift_templates")
    name = models.CharField(max_length=200)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "shift_template"


class ShiftSession(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="shift_sessions")
    station = models.ForeignKey(Station, null=True, blank=True, on_delete=models.SET_NULL, related_name="shift_sessions")
    template = models.ForeignKey(ShiftTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="sessions")
    opened_at = models.DateTimeField()
    closed_at = models.DateTimeField(null=True, blank=True)
    opened_by_user_id = models.IntegerField(null=True, blank=True)
    closed_by_user_id = models.IntegerField(null=True, blank=True)
    opening_cash_float = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    expected_cash_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    closing_cash_counted = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    cash_variance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_sales_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sale_transaction_count = models.IntegerField(default=0)
    # Snapshot at open: [{ "meter_id", "reading", "previous_reading", "meter_name", "dispenser_name" }, ...]
    opening_meters = models.JSONField(default=list, blank=True)
    # Planned staff: [{ "employee_id", "first_name", "last_name", "scheduled_start", "scheduled_end", "notes" }, ...]
    employee_schedule = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "shift_session"


class TankDip(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="tank_dips")
    tank = models.ForeignKey(Tank, on_delete=models.CASCADE, related_name="dips")
    dip_date = models.DateField()
    volume = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    # Book (system) stock immediately before this dip — variance = volume - book_stock_before
    book_stock_before = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    water_level = models.DecimalField(max_digits=10, decimal_places=4, null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tank_dip"


# ---------------------------------------------------------------------------
# Tax
# ---------------------------------------------------------------------------
class Tax(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="taxes")
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tax"


class TaxRate(models.Model):
    tax = models.ForeignKey(Tax, on_delete=models.CASCADE, related_name="rates")
    rate = models.DecimalField(max_digits=6, decimal_places=4)  # e.g. 15.0000 for 15%
    effective_from = models.DateField(null=True, blank=True)
    effective_to = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tax_rate"


# ---------------------------------------------------------------------------
# Subscription ledger (SaaS)
# ---------------------------------------------------------------------------
class SubscriptionLedgerInvoice(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="subscription_invoices")
    invoice_number = models.CharField(max_length=64)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="BDT")
    billing_plan_code = models.CharField(max_length=32, blank=True)
    billing_cycle = models.CharField(max_length=32, blank=True)
    invoice_date = models.DateField()
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)
    paid_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=32, default="draft")
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "subscription_ledger_invoice"
        unique_together = [["company", "invoice_number"]]


# ---------------------------------------------------------------------------
# Loans (borrowed / lent) — operational records + postings via JournalEntry
# ---------------------------------------------------------------------------
class LoanCounterparty(models.Model):
    """Bank, person, employee, vendor, customer, or other party on a loan."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="loan_counterparties")
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=200)
    role_type = models.CharField(
        max_length=32,
        default="other",
        help_text="bank, finance_company, individual, employee, vendor, customer, sister_concern, other",
    )
    employee = models.ForeignKey(
        "Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="loan_counterparties"
    )
    customer = models.ForeignKey(
        "Customer", null=True, blank=True, on_delete=models.SET_NULL, related_name="loan_counterparties"
    )
    vendor = models.ForeignKey(
        "Vendor", null=True, blank=True, on_delete=models.SET_NULL, related_name="loan_counterparties"
    )
    phone = models.CharField(max_length=40, blank=True)
    email = models.CharField(max_length=150, blank=True)
    address = models.TextField(blank=True)
    tax_id = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "loan_counterparty"
        unique_together = [["company", "code"]]


class Loan(models.Model):
    """Money borrowed by the company (liability) or lent by the company (receivable)."""

    DIRECTION_BORROWED = "borrowed"
    DIRECTION_LENT = "lent"

    BANKING_CONVENTIONAL = "conventional"
    BANKING_ISLAMIC = "islamic"

    # general = legacy / unspecified (same behaviour as before these fields existed)
    PRODUCT_GENERAL = "general"
    PRODUCT_TERM_LOAN = "term_loan"  # conventional: fixed tenor, principal+interest instalments
    PRODUCT_BUSINESS_LINE = "business_line"  # conventional: limit; interest typically on utilised balance
    PRODUCT_ISLAMIC_FACILITY = "islamic_facility"  # parent: overall Shariah limit (no postings here)
    PRODUCT_ISLAMIC_DEAL = "islamic_deal"  # child: purpose tranche (e.g. diesel buy); settle anytime; restores limit

    ISLAMIC_VARIANT_MURABAHA = "murabaha"
    ISLAMIC_VARIANT_IJARA = "ijara"
    ISLAMIC_VARIANT_MUDARABAH = "mudarabah"
    ISLAMIC_VARIANT_MUSHARAKAH = "musharakah"
    ISLAMIC_VARIANT_ISTISNA = "istisna"
    ISLAMIC_VARIANT_SALAM = "salam"
    ISLAMIC_VARIANT_OTHER = "other"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="loans")
    loan_no = models.CharField(max_length=64)
    direction = models.CharField(max_length=16)  # borrowed | lent
    status = models.CharField(max_length=24, default="draft")  # draft, active, closed
    counterparty = models.ForeignKey(
        LoanCounterparty, on_delete=models.PROTECT, related_name="loans"
    )
    banking_model = models.CharField(
        max_length=24,
        default=BANKING_CONVENTIONAL,
        help_text="conventional | islamic",
    )
    product_type = models.CharField(
        max_length=32,
        default=PRODUCT_GENERAL,
        help_text="general, term_loan, business_line, islamic_facility, islamic_deal",
    )
    parent_loan = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="child_loans",
        help_text="Islamic deal rows point to their facility parent.",
    )
    deal_reference = models.CharField(
        max_length=64,
        blank=True,
        help_text="Islamic deal / temporary reference (e.g. DEAL-000123).",
    )
    title = models.CharField(max_length=200, blank=True)
    agreement_no = models.CharField(max_length=120, blank=True)
    principal_account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name="loans_principal",
        help_text="Loan payable (borrowed) or loans receivable (lent) GL line.",
    )
    settlement_account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name="loans_settlement",
        help_text="Bank/cash chart line used for disbursement and repayments.",
    )
    interest_account = models.ForeignKey(
        ChartOfAccount,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loans_interest",
        help_text="Interest expense (borrowed) or interest income (lent).",
    )
    interest_accrual_account = models.ForeignKey(
        ChartOfAccount,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loans_interest_accrual",
        help_text="Accrued interest payable (borrowed: liability) or accrued interest receivable (lent: asset).",
    )
    islamic_contract_variant = models.CharField(
        max_length=24,
        blank=True,
        default="",
        help_text="Optional label when banking_model is islamic (murabaha, ijara, etc.); same GL mechanics.",
    )
    sanction_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    outstanding_principal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_disbursed = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_repaid_principal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    start_date = models.DateField(null=True, blank=True)
    maturity_date = models.DateField(null=True, blank=True)
    annual_interest_rate = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        default=Decimal("0"),
        help_text="Annual interest % (0 for zero-interest); required on every loan.",
    )
    term_months = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "loan"
        unique_together = [["company", "loan_no"]]


class LoanDisbursement(models.Model):
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="disbursements")
    disbursement_date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    reference = models.CharField(max_length=200, blank=True)
    memo = models.TextField(blank=True)
    journal_entry = models.ForeignKey(
        JournalEntry, null=True, blank=True, on_delete=models.SET_NULL, related_name="loan_disbursements"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "loan_disbursement"


class LoanRepayment(models.Model):
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="repayments")
    repayment_date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    principal_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    interest_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    reference = models.CharField(max_length=200, blank=True)
    memo = models.TextField(blank=True)
    journal_entry = models.ForeignKey(
        JournalEntry, null=True, blank=True, on_delete=models.SET_NULL, related_name="loan_repayments"
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loan_repayment_reversals",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "loan_repayment"


class LoanInterestAccrual(models.Model):
    """Posted interest accrual (Dr expense / Cr accrued liability for borrowed; mirrored for lent)."""

    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="interest_accruals")
    accrual_date = models.DateField()
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    days_basis = models.PositiveSmallIntegerField(null=True, blank=True)
    memo = models.TextField(blank=True)
    journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loan_interest_accruals",
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loan_interest_accrual_reversals",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "loan_interest_accrual"
        ordering = ["-accrual_date", "-id"]
