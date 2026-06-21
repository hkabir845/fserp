"""API models."""
import bcrypt
from decimal import Decimal

from django.db import models

from api.services.company_code import compute_company_code

# bcrypt has a 72-byte limit on password length; use same encoding everywhere
def _password_bytes(raw_password: str) -> bytes:
    return raw_password.encode("utf-8")[:72]


class Organization(models.Model):
    """
    Tenant group (subscription / portal). One organization owns the login subdomain and
    may contain multiple Company rows (legal entities) sharing that portal.
    """

    name = models.CharField(max_length=200)
    legal_name = models.CharField(max_length=200, blank=True)
    subdomain = models.CharField(max_length=100, blank=True, null=True, unique=True, db_index=True)
    custom_domain = models.CharField(max_length=255, blank=True, null=True, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)
    updated_at = models.DateTimeField(auto_now=True, null=True)

    class Meta:
        db_table = "organization"

    def __str__(self):
        return self.name


class Company(models.Model):
    """Legal entity (books, inventory, stations). Belongs to an Organization (tenant group)."""
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
    # IANA tz database name (e.g. Asia/Dhaka); used for "today" and business-date semantics per tenant.
    time_zone = models.CharField(
        max_length=64,
        default="Asia/Dhaka",
        help_text="IANA time zone (e.g. Asia/Dhaka) for business date and local time display.",
    )
    language = models.CharField(
        max_length=8,
        default="en",
        help_text="UI and aquaculture advice language: en (English) or bn (Bangla).",
    )
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
    # Increment PLATFORM_HOOKS_VERSION in tenant_release when TENANT_RELEASE_HOOKS change;
    # tenants below this version re-run hooks on create or Apply release even if release tag matches.
    platform_hooks_version = models.PositiveIntegerField(default=0)
    # Tenant choice: one operating site (at most one active Station row) vs many locations.
    station_mode = models.CharField(
        max_length=16,
        default="single",
        help_text="single = at most one active station (inactive rows allowed), default for new tenants; multi = multiple active stations.",
    )
    aquaculture_licensed = models.BooleanField(
        default=False,
        help_text="SaaS: new license grants enable Aquaculture in ERP; tenant Admin may turn aquaculture_enabled off in Company settings.",
    )
    aquaculture_enabled = models.BooleanField(
        default=False,
        help_text="When true (and typically aquaculture_licensed), tenant Admin may use Aquaculture in ERP (menu, APIs).",
    )
    aquaculture_go_live_cutover_date = models.DateField(
        null=True,
        blank=True,
        help_text="Cutover date for aquaculture go-live: openings and biological snapshot as of this date.",
    )
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        related_name="companies",
        help_text="Tenant group; portal subdomain and custom domain are stored on Organization.",
    )

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


class BackupRestoreAudit(models.Model):
    """
    Audit trail for tenant backup (export) and destructive restore operations.

    IT-governance control: records who ran a backup/restore, when, for which company,
    the outcome, record/byte counts, and the pre-restore safety snapshot path (if any).
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="backup_restore_audits")
    action = models.CharField(max_length=32, db_index=True, help_text="backup_download | restore")
    success = models.BooleanField(default=True)
    actor_user_id = models.IntegerField(null=True, blank=True)
    actor_label = models.CharField(max_length=255, blank=True, default="")
    source = models.CharField(max_length=48, blank=True, default="", help_text="tenant | admin")
    ip_address = models.CharField(max_length=64, blank=True, default="")
    record_count = models.IntegerField(null=True, blank=True)
    bytes_size = models.BigIntegerField(null=True, blank=True)
    safety_snapshot_path = models.CharField(max_length=1024, blank=True, default="")
    error_message = models.TextField(blank=True)
    detail = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "backup_restore_audit"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["company", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.action} company={self.company_id} ok={self.success} @ {self.created_at}"


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
    # Cashier/operator: what this login may sell at POS (enforced in /api/cashier/pos/). Others ignore (both).
    pos_sale_scope = models.CharField(max_length=16, default="both")
    company_id = models.IntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    # When set, POS and station-scoped reports are limited to this site (cashier/operator, or a regional user).
    home_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="users_assigned_home",
    )
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
        indexes = [
            models.Index(fields=["user", "used_at"]),
            models.Index(fields=["expires_at"]),
        ]


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
    operates_fuel_retail = models.BooleanField(
        default=True,
        help_text="Fuel forecourt site (tanks, islands, nozzles). False for aquaculture/shop-only hubs without underground fuel.",
    )
    default_aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="stations_default_shop_outlet",
        help_text="Optional default pond for aquaculture shop stock issues and expense defaults at this location.",
    )
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
    content_weight_kg = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True,
        help_text=(
            "Labeled kg per selling unit for sack-packed feed (e.g. 25). "
            "Inventory and POS quantities use `unit` (typically sack); this is for weight hints and reporting."
        ),
    )
    pieces_per_kg = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True,
        help_text=(
            "Fish / fry only: how many pieces (heads) make one kilogram (pcs/kg). "
            "Used on vendor bills to derive weight and headcount from quantity and amount."
        ),
    )
    category = models.CharField(
        max_length=100,
        default="General",
        help_text="Reporting / merchandising category (for item and category sales reports).",
    )
    barcode = models.CharField(max_length=64, blank=True)
    is_taxable = models.BooleanField(default=True)
    is_pos_available = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    image_url = models.CharField(max_length=500, blank=True)
    revenue_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="items_default_revenue",
        help_text="When set, invoice/POS revenue for this SKU posts here instead of template fuel/shop revenue codes.",
    )
    cogs_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="items_default_cogs",
        help_text="When set, COGS for this SKU uses this account instead of template COGS codes.",
    )
    inventory_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="items_default_inventory",
        help_text="When set, inventory receipt/sale GL for this SKU uses this asset account instead of 1200/1220.",
    )
    expense_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="items_default_expense",
        help_text="When set, non-inventory vendor bill lines for this SKU debit this expense (else office default).",
    )
    opening_stock_quantity = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        default=0,
        help_text="Go-live on-hand quantity treated as opening inventory (capitalized to the inventory asset, offset to Opening Balance Equity). Distinct from later bill receipts.",
    )
    opening_stock_unit_cost = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        default=0,
        help_text="Unit cost used to value opening stock at go-live (opening value = opening_stock_quantity x this).",
    )
    opening_balance_date = models.DateField(
        null=True,
        blank=True,
        help_text="As-of date for the opening inventory G/L entry (AUTO-ITEM-OB-{id}).",
    )
    opening_balance_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="item_openings",
        help_text="AUTO-ITEM-OB-{item id} when opening stock is posted to the G/L (Dr inventory / Cr 3200).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item"


class ItemStationStock(models.Model):
    """
    Per-station on-hand quantity for shop / non-tank inventory items.
    For station-bin SKUs, Item.quantity_on_hand is the sum of this table plus ItemPondStock (pond-side stores).
    Fuel and tank-tracked products use Tank.current_stock only; no rows here.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="item_station_stocks")
    station = models.ForeignKey("Station", on_delete=models.CASCADE, related_name="item_stocks")
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="station_stocks")
    quantity = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item_station_stock"
        unique_together = [["station", "item"]]
        indexes = [
            models.Index(fields=["company", "item"]),
        ]


class ItemPondStock(models.Model):
    """
    Feed / supplies physically at a pond (transferred from a shop station). Company QOH for station-bin SKUs is
    the sum of ItemStationStock and ItemPondStock. Consumed when feeding advice is applied or adjusted manually.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="item_pond_stocks")
    pond = models.ForeignKey("AquaculturePond", on_delete=models.CASCADE, related_name="item_stocks")
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="pond_stocks")
    quantity = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "item_pond_stock"
        unique_together = [["pond", "item"]]
        indexes = [
            models.Index(fields=["company", "item"]),
        ]


class PondWarehouseStockReceipt(models.Model):
    """
    Audit trail: shop station bin → pond warehouse (ItemPondStock). No GL; company inventory unchanged.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="pond_warehouse_receipts")
    from_station = models.ForeignKey(
        "Station",
        on_delete=models.PROTECT,
        related_name="pond_warehouse_receipts_out",
    )
    pond = models.ForeignKey(
        "AquaculturePond",
        on_delete=models.CASCADE,
        related_name="warehouse_stock_receipts",
    )
    receipt_number = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pond_warehouse_stock_receipt"
        ordering = ["-created_at", "-id"]


class PondWarehouseStockReceiptLine(models.Model):
    receipt = models.ForeignKey(
        PondWarehouseStockReceipt,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="pond_warehouse_receipt_lines")
    quantity = models.DecimalField(max_digits=14, decimal_places=4)

    class Meta:
        db_table = "pond_warehouse_stock_receipt_line"


class PondWarehouseStockReturn(models.Model):
    """
    Audit trail: pond warehouse → shop station bin (ItemPondStock → ItemStationStock). No GL.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="pond_warehouse_returns")
    pond = models.ForeignKey(
        "AquaculturePond",
        on_delete=models.CASCADE,
        related_name="warehouse_stock_returns",
    )
    to_station = models.ForeignKey(
        "Station",
        on_delete=models.PROTECT,
        related_name="pond_warehouse_returns_in",
    )
    return_number = models.CharField(max_length=64, blank=True)
    memo = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pond_warehouse_stock_return"
        ordering = ["-created_at", "-id"]


class PondWarehouseStockReturnLine(models.Model):
    stock_return = models.ForeignKey(
        PondWarehouseStockReturn,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="pond_warehouse_return_lines")
    quantity = models.DecimalField(max_digits=14, decimal_places=4)

    class Meta:
        db_table = "pond_warehouse_stock_return_line"


class PondWarehouseInterPondTransfer(models.Model):
    """
    Reallocate feed/medicine between pond warehouses (no GL; company inventory unchanged).
    When both ponds share a warehouse group, moves allocation within the shared pool.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="pond_warehouse_inter_pond_transfers")
    from_pond = models.ForeignKey(
        "AquaculturePond",
        on_delete=models.CASCADE,
        related_name="warehouse_transfers_out",
    )
    to_pond = models.ForeignKey(
        "AquaculturePond",
        on_delete=models.CASCADE,
        related_name="warehouse_transfers_in",
    )
    transfer_number = models.CharField(max_length=64, blank=True)
    memo = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pond_warehouse_inter_pond_transfer"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["company", "from_pond", "created_at"]),
            models.Index(fields=["company", "to_pond", "created_at"]),
        ]


class PondWarehouseInterPondTransferLine(models.Model):
    transfer = models.ForeignKey(
        PondWarehouseInterPondTransfer,
        on_delete=models.CASCADE,
        related_name="lines",
    )
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="pond_warehouse_inter_pond_transfer_lines")
    quantity = models.DecimalField(max_digits=14, decimal_places=4)

    class Meta:
        db_table = "pond_warehouse_inter_pond_transfer_line"


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
    default_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="customers_preferred_site",
        help_text="Default selling / visit site for new invoices; AR register when payment is on account.",
    )
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
    opening_balance_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="customer_openings",
        help_text="AUTO-CUST-OB-{customer id} when opening balance is posted to the G/L.",
    )
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customer"


class Vendor(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="vendors")
    default_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="vendors_preferred_site",
        help_text="Default receiving site for new bills and vendor payment routing when not bill-specific.",
    )
    default_aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="vendors_preferred_delivery_pond",
        help_text="Optional default pond for fish/fry deliveries; new bills use linked shop site stock when configured.",
    )
    default_expense_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="vendors_default_expense",
        help_text="Default expense debit for vendor bill lines without an item or without a line-level GL override.",
    )
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
    opening_balance_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="vendor_openings",
        help_text="AUTO-VEND-OB-{vendor id} when opening balance is posted to the G/L.",
    )
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "vendor"


class Employee(models.Model):
    """Company staff record; subledger entries track payables/advances until payroll is integrated."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="employees")
    home_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="employees_home",
        help_text="Primary work site for this employee (ops / labor cost reporting).",
    )
    home_aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="employees_home",
        help_text=(
            "Primary pond for pond-based labor: payroll and aquaculture P&L attribute "
            "this employee's wages to this profit center."
        ),
    )
    aquaculture_labor_scope = models.CharField(
        max_length=32,
        default="not_applicable",
        db_index=True,
        choices=(
            ("not_applicable", "Not applicable (site / company payroll)"),
            ("assigned_pond", "Single pond"),
            ("all_ponds_equal", "Shared equally across all ponds"),
        ),
        help_text=(
            "not_applicable: fuel forecourt, admin, shop staff — wages are not split to pond P&L. "
            "assigned_pond: field / pond worker — wages to home pond (or shop site default when set). "
            "all_ponds_equal: shared aquaculture managers — salary split evenly on all active ponds."
        ),
    )
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
    opening_balance_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="employee_openings",
        help_text="AUTO-EMP-OB-{employee id} when opening balance is posted to the G/L.",
    )
    current_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "employee"


class EmployeeLedgerEntry(models.Model):
    """
    HR subledger: debit increases net payable to employee (e.g. accrued wages);
    credit decreases (payment to employee, advance recovery). Manual lines have no
    payroll_run; posting payroll to the G/L creates lines linked to that run.
    """

    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="ledger_entries"
    )
    payroll_run = models.ForeignKey(
        "PayrollRun",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="employee_ledger_entries",
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
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payroll_runs",
        help_text="Optional: attribute this run to one site (management / job-cost reporting; GL still company-level).",
    )
    subledger_employee = models.ForeignKey(
        Employee,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payroll_runs_subledger",
        help_text="When set (from-one-employee), posted payroll subledger lines are attributed entirely to this person.",
    )
    payroll_number = models.CharField(max_length=64, blank=True)
    pay_period_start = models.DateField()
    pay_period_end = models.DateField()
    payment_date = models.DateField()
    # Gross pay = base_salary_total + overtime_amount + bonus_amount + other_earnings_amount
    base_salary_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    overtime_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    bonus_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    other_earnings_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_gross = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_net = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    salary_expense_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payroll_runs_salary_expense",
        help_text="When set, posted salary journals debit this expense instead of template 6400.",
    )
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


class TenantReportingCategory(models.Model):
    """
    Tenant-defined labels/codes for reporting, merged with built-in Aquaculture categories
    or used as tags (e.g. manual journal lines for fuel-station rollup).
    """

    APPLICATION_AQUACULTURE = "aquaculture"
    APPLICATION_FUEL_STATION = "fuel_station"
    APPLICATION_CHOICES = (
        (APPLICATION_AQUACULTURE, "Aquaculture"),
        (APPLICATION_FUEL_STATION, "Fuel station"),
    )
    KIND_EXPENSE = "expense"
    KIND_INCOME = "income"
    KIND_CHOICES = (
        (KIND_EXPENSE, "Expense"),
        (KIND_INCOME, "Income"),
    )

    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, related_name="tenant_reporting_categories"
    )
    application = models.CharField(max_length=32, choices=APPLICATION_CHOICES, db_index=True)
    kind = models.CharField(max_length=16, choices=KIND_CHOICES, db_index=True)
    code = models.CharField(
        max_length=64,
        db_index=True,
        help_text="Stable key stored on transactions (aquaculture) or shown in pickers.",
    )
    label = models.CharField(max_length=200)
    maps_to_code = models.CharField(
        max_length=64,
        help_text="Built-in aquaculture code, or fuel-station rollup key, used for GL / bucket logic.",
    )
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tenant_reporting_categories",
        help_text="When set, category applies only to this station. Null = all stations in application.",
    )
    aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tenant_reporting_categories",
        help_text="When set, category applies only to this pond. Null = all ponds in application.",
    )
    head_office_only = models.BooleanField(
        default=False,
        help_text="When true, category applies only to head office (no station or pond tag).",
    )
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "tenant_reporting_category"
        ordering = ["application", "kind", "sort_order", "code"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "application", "kind", "code"],
                name="tenant_reporting_cat_company_app_kind_code_uniq",
            ),
            models.CheckConstraint(
                check=~models.Q(station__isnull=False, aquaculture_pond__isnull=False),
                name="tenant_reporting_cat_station_pond_mutually_exclusive",
            ),
            models.CheckConstraint(
                check=~models.Q(head_office_only=True, station__isnull=False),
                name="tenant_reporting_cat_ho_not_with_station",
            ),
            models.CheckConstraint(
                check=~models.Q(head_office_only=True, aquaculture_pond__isnull=False),
                name="tenant_reporting_cat_ho_not_with_pond",
            ),
        ]

    def __str__(self):
        return f"{self.company_id}:{self.application}:{self.kind}:{self.code}"


class JournalEntry(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="journal_entries")
    entry_number = models.CharField(max_length=64, blank=True)
    entry_date = models.DateField()
    description = models.TextField(blank=True)
    # Optional analytic site (AUTO-* from invoice, bill, POS, dip, etc.); null = company-wide / treasury.
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="journal_entries",
        help_text="Site dimension for reporting; not required for balanced double-entry.",
    )
    is_posted = models.BooleanField(default=False)
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "journal_entry"


class JournalEntryLine(models.Model):
    journal_entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="lines")
    account = models.ForeignKey(ChartOfAccount, on_delete=models.CASCADE, related_name="journal_lines")
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="journal_lines",
        help_text="Selling or register site for this line; enables site-scoped P&L and trial balance.",
    )
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    description = models.CharField(max_length=300, blank=True)
    aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="journal_lines",
        help_text="Optional pond dimension for aquaculture auto-journals (costing / traceability).",
    )
    aquaculture_production_cycle = models.ForeignKey(
        "AquacultureProductionCycle",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="journal_lines",
        help_text="Optional production cycle when the aquaculture line is cycle-scoped.",
    )
    aquaculture_cost_bucket = models.CharField(
        max_length=40,
        blank=True,
        db_index=True,
        help_text="Stable cost bucket code (e.g. feed, labor, biological_loss) for reporting joins.",
    )
    tenant_reporting_category = models.ForeignKey(
        "TenantReportingCategory",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="journal_lines",
        help_text="Optional tenant-defined fuel-station reporting tag on manual journal lines.",
    )
    fuel_station_expense_rollup = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="Built-in fuel-station expense rollup when no tenant_reporting_category FK is set.",
    )

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


class InventoryTransfer(models.Model):
    """Inter-station movement of shop (non-tank) inventory. Posted = stock + GL (same inventory account)."""

    STATUS_DRAFT = "draft"
    STATUS_POSTED = "posted"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="inventory_transfers")
    from_station = models.ForeignKey(
        "Station", on_delete=models.PROTECT, related_name="inventory_transfers_out"
    )
    to_station = models.ForeignKey(
        "Station", on_delete=models.PROTECT, related_name="inventory_transfers_in"
    )
    transfer_number = models.CharField(max_length=64, blank=True)
    transfer_date = models.DateField()
    status = models.CharField(max_length=16, default=STATUS_DRAFT)
    memo = models.CharField(max_length=500, blank=True)
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_transfer"
        ordering = ["-transfer_date", "-id"]


class InventoryTransferLine(models.Model):
    transfer = models.ForeignKey(
        InventoryTransfer, on_delete=models.CASCADE, related_name="lines"
    )
    item = models.ForeignKey(Item, on_delete=models.PROTECT, related_name="inventory_transfer_lines")
    quantity = models.DecimalField(max_digits=14, decimal_places=4)

    class Meta:
        db_table = "inventory_transfer_line"


class InventoryAdjustment(models.Model):
    """Stock-count / adjustment for shop (non-tank) inventory at one station — the C-store analogue
    of a fuel tank dip.

    Posting sets on-hand to the counted quantity and books the variance to GL at unit cost:
    loss (counted < book) -> Dr 5210 Inventory Shrinkage / Cr inventory asset; gain (counted > book)
    -> Dr inventory asset / Cr 5210. Fuel uses tank dips and fish uses the aquaculture stock ledger,
    so both are excluded here.
    """

    STATUS_DRAFT = "draft"
    STATUS_POSTED = "posted"

    REASON_CHOICES = [
        ("count", "Stock count / cycle count"),
        ("damage", "Damage / breakage"),
        ("theft", "Theft / loss"),
        ("expiry", "Expiry / spoilage"),
        ("other", "Other"),
    ]

    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, related_name="inventory_adjustments"
    )
    station = models.ForeignKey(
        "Station", on_delete=models.PROTECT, related_name="inventory_adjustments"
    )
    adjustment_number = models.CharField(max_length=64, blank=True)
    adjustment_date = models.DateField()
    reason = models.CharField(max_length=16, default="count")
    status = models.CharField(max_length=16, default=STATUS_DRAFT)
    memo = models.CharField(max_length=500, blank=True)
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "inventory_adjustment"
        ordering = ["-adjustment_date", "-id"]


class InventoryAdjustmentLine(models.Model):
    adjustment = models.ForeignKey(
        InventoryAdjustment, on_delete=models.CASCADE, related_name="lines"
    )
    item = models.ForeignKey(
        Item, on_delete=models.PROTECT, related_name="inventory_adjustment_lines"
    )
    counted_quantity = models.DecimalField(max_digits=14, decimal_places=4)
    # Snapshots captured at post time so unpost restores exactly and the GL stays reproducible.
    book_quantity = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)

    class Meta:
        db_table = "inventory_adjustment_line"


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
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoices",
        help_text="Selling location: ties sales and shop COGS to a station for reporting.",
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
    nozzle = models.ForeignKey(
        "Nozzle",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_lines",
        help_text="Forecourt nozzle used for this fuel sale line (POS attribution).",
    )
    description = models.CharField(max_length=300, blank=True)
    quantity = models.DecimalField(max_digits=14, decimal_places=4, default=1)
    unit_price = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    revenue_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_lines_revenue_override",
        help_text="Optional revenue GL for this line; overrides item-level revenue and template splits.",
    )
    receipt_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_lines_receipt",
        help_text="Optional per-line selling site for revenue/COGS entity P&L (overrides invoice header).",
    )
    aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_lines",
        help_text="When set, revenue/COGS from this line are tagged for aquaculture pond P&L.",
    )
    fuel_station_income_category = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="Fuel-station income rollup or tenant category code (station P&L on invoices).",
    )
    aquaculture_income_category = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="Aquaculture income type or tenant category code (pond P&L on invoices).",
    )
    tenant_reporting_category = models.ForeignKey(
        "TenantReportingCategory",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_lines",
        help_text="Resolved tenant reporting row for custom income/expense sub-tags.",
    )

    class Meta:
        db_table = "invoice_line"


class Bill(models.Model):
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="bills")
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name="bills")
    receipt_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bills_receipts",
        help_text="Shop (non-tank) inventory from this bill is received into this station's stock.",
    )
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
    expense_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bill_lines_expense_override",
        help_text="Optional expense/COGS-side debit for this line; overrides item and vendor defaults.",
    )
    aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bill_lines",
        help_text="When set, expense-side GL lines from this bill line are tagged for aquaculture pond P&L.",
    )
    aquaculture_production_cycle = models.ForeignKey(
        "AquacultureProductionCycle",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bill_lines",
        help_text="Optional production cycle (must belong to aquaculture_pond).",
    )
    aquaculture_cost_bucket = models.CharField(
        max_length=40,
        blank=True,
        help_text="Optional P&L cost bucket when aquaculture_pond is set (e.g. equipment, feed).",
    )
    aquaculture_fish_weight_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="For fish-type items (Item.pos_category=fish): total weight (kg) on this line (optional).",
    )
    aquaculture_fish_count = models.IntegerField(
        null=True,
        blank=True,
        help_text="For fish-type items: total headcount on this line (optional).",
    )
    aquaculture_fish_species = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="For fish-type items: species stocked (fry/fingerling), e.g. tilapia, rui, pangas.",
    )
    aquaculture_fish_species_other = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text="Free-text species name when aquaculture_fish_species is 'other'.",
    )
    receipt_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bill_lines_receipt",
        help_text="Optional per-line station for GL/stock when split across sites or overriding the bill header.",
    )
    fuel_station_expense_category = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text="Fuel-station expense rollup or tenant category code (station P&L on bills).",
    )
    tenant_reporting_category = models.ForeignKey(
        "TenantReportingCategory",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bill_lines",
        help_text="Resolved tenant fuel-station reporting row when fuel_station_expense_category is custom.",
    )

    class Meta:
        db_table = "bill_line"

    def clean(self):
        """Fish stocking lines must carry headcount and weight together: biomass and bio-asset are
        derived from both, so a count without a weight (or vice-versa) is rejected. Primary
        enforcement is the bill API; this guards admin/forms and explicit full_clean callers."""
        super().clean()
        count = self.aquaculture_fish_count
        weight = self.aquaculture_fish_weight_kg
        has_count = count is not None and count > 0
        has_weight = weight is not None and weight > 0
        if has_count != has_weight:
            from django.core.exceptions import ValidationError

            raise ValidationError(
                "Fish lines must record headcount and weight together (both greater than zero) so "
                "biomass and bio-asset stay computable."
            )


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
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="payments",
        help_text="Register / management site: derived from invoices or bills, or from party default when on account.",
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
    # Snapshot at close: [{ "meter_id", "reading", "previous_reading", "meter_name", "dispenser_name" }, ...]
    closing_meters = models.JSONField(default=list, blank=True)
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

    PARTY_CUSTOMER = "customer"
    PARTY_SUPPLIER = "supplier"
    PARTY_LENDER = "lender"
    PARTY_BORROWER = "borrower"
    PARTY_BOTH = "both"
    PARTY_OTHER = "other"

    OPENING_ZERO = "zero"
    OPENING_RECEIVABLE = "receivable"  # party owes your company
    OPENING_PAYABLE = "payable"  # your company owes the party

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="loan_counterparties")
    code = models.CharField(max_length=32)
    name = models.CharField(max_length=200)
    role_type = models.CharField(
        max_length=32,
        default="other",
        help_text="bank, finance_company, individual, employee, vendor, customer, sister_concern, other",
    )
    party_kind = models.CharField(
        max_length=20,
        default=PARTY_OTHER,
        help_text="customer, supplier, lender, borrower, both, other (business context for the party)",
    )
    opening_balance_type = models.CharField(
        max_length=20,
        default=OPENING_ZERO,
        help_text="receivable | payable | zero (opening loan with no history in this system)",
    )
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_balance_as_of = models.DateField(null=True, blank=True)
    opening_interest_applicable = models.BooleanField(default=False)
    opening_annual_interest_rate = models.DecimalField(
        max_digits=8, decimal_places=4, null=True, blank=True,
        help_text="Indicative annual % on opening; accrual uses loan facilities once booked.",
    )
    opening_principal_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loan_counterparties_opening_principal",
        help_text="GL used in opening entry (receivable 1160- or payable 2410-style line).",
    )
    opening_equity_account = models.ForeignKey(
        "ChartOfAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loan_counterparties_opening_equity",
        help_text="If set, use instead of default 3200 Opening Balance Equity for the Cr/Dr on opening.",
    )
    opening_balance_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loan_counterparty_openings",
    )
    opening_balance_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loan_counterparty_openings",
        help_text="Optional GL site tag on counterparty opening balance journal lines.",
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
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="loans",
        help_text=(
            "Optional site for GL tagging on disbursements, repayments, and accruals "
            "(management / segment reporting; cash still settles through the chosen bank account)."
        ),
    )
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
    aquaculture_financing = models.BooleanField(
        default=False,
        help_text=(
            "Whole-aquaculture working-capital loan; shown on Aquaculture → Financing with pond "
            "allocation and repayment worksheet."
        ),
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "loan"
        unique_together = [["company", "loan_no"]]


class AquacultureFinancingAllocation(models.Model):
    """
    Management allocation of aquaculture loan funds to ponds (use) or pond contribution toward repayment.
    Does not replace GL; complements loan disburse/repay and pond P&L.
    """

    KIND_USE = "use"
    KIND_REPAYMENT = "repayment"

    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, related_name="aquaculture_financing_allocations"
    )
    loan = models.ForeignKey(Loan, on_delete=models.CASCADE, related_name="aquaculture_financing_allocations")
    pond = models.ForeignKey(
        "AquaculturePond", on_delete=models.CASCADE, related_name="financing_allocations"
    )
    allocation_date = models.DateField(db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    allocation_kind = models.CharField(max_length=16, default=KIND_USE)
    disbursement = models.ForeignKey(
        "LoanDisbursement",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_financing_allocations",
    )
    profit_transfer = models.ForeignKey(
        "AquaculturePondProfitTransfer",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="financing_allocations",
    )
    memo = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "aquaculture_financing_allocation"
        ordering = ["-allocation_date", "-id"]
        indexes = [
            models.Index(fields=["company", "loan", "allocation_date"]),
            models.Index(fields=["company", "pond", "allocation_date"]),
        ]


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


class FixedAsset(models.Model):
    """Capital asset register with straight-line depreciation and GL posting."""

    STATUS_DRAFT = "draft"
    STATUS_ACTIVE = "active"
    STATUS_FULLY_DEPRECIATED = "fully_depreciated"
    STATUS_DISPOSED = "disposed"

    METHOD_STRAIGHT_LINE = "straight_line"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="fixed_assets")
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fixed_assets",
        help_text="Site for depreciation expense tagging (P&L / segment reporting).",
    )
    aquaculture_pond = models.ForeignKey(
        "AquaculturePond",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fixed_assets",
        help_text="Pond entity for depreciation expense when asset belongs to aquaculture.",
    )
    company_wide = models.BooleanField(
        default=False,
        help_text=(
            "Shared / head-office asset (e.g. manager vehicle). Depreciation expense is not tagged "
            "to a station or pond — appears on company-wide P&L only."
        ),
    )
    asset_number = models.CharField(max_length=64)
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=24, default=STATUS_DRAFT)
    asset_account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name="fixed_assets_asset",
        help_text="Fixed-asset GL line (e.g. 1510–1540).",
    )
    accumulated_depreciation_account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name="fixed_assets_accum_depr",
        help_text="Contra-asset accumulated depreciation (e.g. 1550).",
    )
    depreciation_expense_account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name="fixed_assets_depr_expense",
        help_text="Depreciation expense P&L line (e.g. 6320).",
    )
    settlement_account = models.ForeignKey(
        ChartOfAccount,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fixed_assets_settlement",
        help_text="Bank/cash line for acquisition posting when capitalizing a new purchase.",
    )
    acquisition_date = models.DateField(null=True, blank=True)
    in_service_date = models.DateField(null=True, blank=True)
    disposal_date = models.DateField(null=True, blank=True)
    acquisition_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    salvage_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    useful_life_months = models.PositiveSmallIntegerField(default=60)
    depreciation_method = models.CharField(max_length=24, default=METHOD_STRAIGHT_LINE)
    opening_accumulated_depreciation = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text="Already-depreciated amount when adopting an asset mid-life (no acquisition JE).",
    )
    accumulated_depreciation = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text="Running total posted to accumulated depreciation (includes opening balance).",
    )
    last_depreciation_date = models.DateField(null=True, blank=True)
    acquisition_journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fixed_asset_acquisitions",
    )
    disposal_journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fixed_asset_disposals",
    )
    memo = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "fixed_asset"
        unique_together = [["company", "asset_number"]]
        ordering = ["-created_at", "-id"]


class FixedAssetDepreciationRun(models.Model):
    """Posted depreciation for one asset and period."""

    fixed_asset = models.ForeignKey(FixedAsset, on_delete=models.CASCADE, related_name="depreciation_runs")
    run_date = models.DateField()
    period_start = models.DateField(null=True, blank=True)
    period_end = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    memo = models.TextField(blank=True)
    journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fixed_asset_depreciation_runs",
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fixed_asset_depreciation_reversals",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "fixed_asset_depreciation_run"
        ordering = ["-run_date", "-id"]


# ---------------------------------------------------------------------------
# Aquaculture (optional module per company)
# ---------------------------------------------------------------------------


class AquacultureWarehouseGroup(models.Model):
    """
    Shared physical feed/medicine store for multiple ponds (e.g. Ashari-1 + Ashari-2 on one canal shed).
    Member ponds keep per-pond ItemPondStock rows as allocations; pool on hand = sum of member allocations.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_warehouse_groups")
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=64, blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_warehouse_group"
        ordering = ["name", "id"]
        indexes = [
            models.Index(fields=["company", "is_active"]),
        ]

    def __str__(self):
        return self.name


class AquaculturePond(models.Model):
    """Fish pond / profit center within a company."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_ponds")
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=64, blank=True, help_text="Short code for reports (optional).")
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    leasing_area_decimal = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Leased land area in decimals — used with lease price per decimal for landlord rent.",
    )
    water_area_decimal = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Effective water surface area in decimals — for stocking, density, and production planning.",
    )
    pond_depth_ft = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text=(
            "Representative average depth in feet — with water area (decimals) uses "
            "435.6 sq ft per decimal for volume."
        ),
    )
    lease_contract_start = models.DateField(null=True, blank=True)
    lease_contract_end = models.DateField(null=True, blank=True)
    lease_price_per_decimal_per_year = models.DecimalField(
        max_digits=18, decimal_places=2, null=True, blank=True
    )
    lease_paid_to_landlord = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=0,
        help_text="Cumulative cash/rent paid to the landlord for this pond lease.",
    )
    pos_customer = models.ForeignKey(
        "Customer",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_ponds_pos",
        help_text="Optional AR customer for General POS: sell feed and supplies on account to this pond.",
    )
    auto_pos_customer = models.BooleanField(
        default=False,
        help_text="When true, pos_customer was created for this pond; display name and active flag sync from pond.",
    )
    default_feed_item = models.ForeignKey(
        Item,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="ponds_default_feed",
        help_text="Inventory SKU drawn from this pond's warehouse when feeding advice is applied (sack or kg unit).",
    )
    default_medicine_item = models.ForeignKey(
        Item,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="ponds_default_medicine",
        help_text="Inventory SKU drawn from this pond's warehouse when recording medicine consumption.",
    )
    pond_role = models.CharField(
        max_length=32,
        default="grow_out",
        db_index=True,
        help_text="grow_out | nursing | broodstock | other — for filters and transfer workflows (management only).",
    )
    physical_site_name = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text=(
            "Shared water-body name for ponds on the same physical site (e.g. Mynuddin). "
            "Use with a nursing-phase and grow-out-phase profit center per site."
        ),
    )
    is_virtual = models.BooleanField(
        default=False,
        help_text="Deprecated — all ponds are physical. Do not use.",
    )
    linked_grow_out_pond = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="same_site_nursing_phases",
        help_text=(
            "For nursing-role ponds: grow-out profit center on the same physical site "
            "(remainder fingerlings after nursing transfers, e.g. Mynuddin Nursing → Mynuddin Pond)."
        ),
    )
    warehouse_group = models.ForeignKey(
        AquacultureWarehouseGroup,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="ponds",
        help_text=(
            "When set, this pond's pond-warehouse balance is an allocation from a shared physical store. "
            "Use pond-to-pond warehouse transfer to reallocate between members."
        ),
    )
    pl_opening_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_pond_pl_openings",
        help_text="AUTO-POND-PL-OB-{pond id} when prior P&L openings are posted to the G/L.",
    )
    prior_pl_zero_confirmed_at = models.DateField(
        null=True,
        blank=True,
        help_text="Go-live: user confirmed no prior revenue or costs before cutover (all P&L categories zero).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_pond"
        ordering = ["sort_order", "id"]
        indexes = [
            models.Index(fields=["company", "is_active"]),
        ]

    def __str__(self):
        return self.name


class AquaculturePondPlOpening(models.Model):
    """
    Go-live P&L opening by income type or expense category for one pond.
    Does not post GL; complements operational sales/expenses after cutover.
    Landlord rent openings stay on AquacultureLandlord, not here.
    """

    KIND_INCOME = "income"
    KIND_EXPENSE = "expense"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_pond_pl_openings")
    pond = models.ForeignKey(
        AquaculturePond, on_delete=models.CASCADE, related_name="pl_openings"
    )
    pl_kind = models.CharField(max_length=16, db_index=True)
    category_code = models.CharField(max_length=64, db_index=True)
    amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text="Positive amount; interpreted as revenue (income) or cost (expense) by pl_kind.",
    )
    as_of_date = models.DateField(null=True, blank=True)
    memo = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_pond_pl_opening"
        ordering = ["pl_kind", "category_code"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "pond", "pl_kind", "category_code"],
                name="uq_aq_pond_pl_opening_kind_cat",
            ),
        ]
        indexes = [
            models.Index(fields=["company", "pond", "pl_kind"]),
        ]


class AquacultureLandlord(models.Model):
    """Lease counterparty: may hold land across multiple ponds (see pond shares)."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_landlords")
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=64, blank=True)
    phone = models.CharField(max_length=64, blank=True)
    email = models.EmailField(blank=True)
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    opening_balance = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        default=0,
        help_text="Subledger opening: positive = rent owed to landlord; negative = credit or prepaid.",
    )
    opening_balance_date = models.DateField(
        null=True,
        blank=True,
        help_text="As-of date for the opening balance adjustment in the landlord ledger.",
    )
    opening_balance_ledger_entry = models.ForeignKey(
        "AquacultureLandlordLedgerEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="landlord_opening_for",
        help_text="AUTO adjustment row created from opening_balance (reference OPENING).",
    )
    opening_balance_journal = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_landlord_openings",
        help_text="AUTO-LL-OB-{landlord id} when opening balance is posted to the G/L.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_landlord"
        ordering = ["name", "id"]
        indexes = [
            models.Index(fields=["company", "is_active"]),
        ]

    def __str__(self):
        return self.name or f"Landlord #{self.pk}"


class AquacultureLandlordPondShare(models.Model):
    """How much leased land (decimals) is attributed to a landlord on a given pond."""

    landlord = models.ForeignKey(
        AquacultureLandlord, on_delete=models.CASCADE, related_name="pond_shares"
    )
    pond = models.ForeignKey(
        AquaculturePond, on_delete=models.CASCADE, related_name="landlord_pond_shares"
    )
    land_area_decimal = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        help_text="Portion of leased land (decimals) for this landlord on this pond.",
    )
    notes = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_landlord_pond_share"
        unique_together = [("landlord", "pond")]
        indexes = [
            models.Index(fields=["pond"]),
        ]


class AquacultureLandlordLedgerEntry(models.Model):
    """
    Subledger: positive amount_signed increases obligation to the landlord (rent due);
    negative reduces it (payment or credit). Optional link to a pond; payments may bump
    AquaculturePond.lease_paid_to_landlord when applies_to_lease_paid is true.
    """

    KIND_RENT_CHARGE = "rent_charge"
    KIND_PAYMENT = "payment"
    KIND_ADJUSTMENT = "adjustment"
    KIND_CHOICES = (
        (KIND_RENT_CHARGE, "Rent charge"),
        (KIND_PAYMENT, "Payment"),
        (KIND_ADJUSTMENT, "Adjustment"),
    )

    landlord = models.ForeignKey(
        AquacultureLandlord, on_delete=models.CASCADE, related_name="ledger_entries"
    )
    pond = models.ForeignKey(
        AquaculturePond,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="landlord_ledger_entries",
    )
    entry_date = models.DateField(db_index=True)
    kind = models.CharField(max_length=32, choices=KIND_CHOICES)
    amount_signed = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        help_text="Positive: obligation to landlord increases; negative: payment or credit.",
    )
    memo = models.CharField(max_length=500, blank=True)
    reference = models.CharField(max_length=200, blank=True)
    applies_to_lease_paid = models.BooleanField(
        default=False,
        help_text="If true, creating this row increased lease_paid_to_landlord on pond.",
    )
    lease_paid_delta = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Positive amount added to pond lease_paid_to_landlord when applies_to_lease_paid is true.",
    )
    bank_account = models.ForeignKey(
        "BankAccount",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_landlord_ledger_entries",
        help_text="When set on a payment, posts Dr aquaculture lease expense (6711) / Cr this register's G/L.",
    )
    payment_method = models.CharField(
        max_length=32,
        blank=True,
        default="cash",
        help_text="Mirrors Payment.payment_method for resolving cash vs bank G/L credit line.",
    )
    station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_landlord_ledger_entries",
        help_text="Optional site dimension on the auto journal (e.g. Premium Agro hub paying lease).",
    )
    journal_entry = models.ForeignKey(
        "JournalEntry",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_landlord_ledger_entries",
        help_text="AUTO-LL-PAY-{this row id} when bank_account is set and G/L posted.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "aquaculture_landlord_ledger_entry"
        ordering = ["entry_date", "id"]
        indexes = [
            models.Index(fields=["landlord", "entry_date"]),
        ]


class AquacultureProductionCycle(models.Model):
    """Optional production batch / crop window under a pond (profit-center tag for income and direct costs)."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_production_cycles")
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="production_cycles")
    name = models.CharField(max_length=200)
    code = models.CharField(
        max_length=64,
        blank=True,
        help_text="Optional short code for filters and exports.",
    )
    fish_species = models.CharField(
        max_length=64,
        db_index=True,
        default="tilapia",
        blank=True,
        help_text="Primary species in this stocking batch (e.g. tilapia fry cohort).",
    )
    fish_species_other = models.CharField(max_length=120, blank=True)
    source_production_cycle = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="derived_production_cycles",
        help_text="Nursing batch this grow-out batch was stocked from (fingerling transfer).",
    )
    start_date = models.DateField(db_index=True)
    end_date = models.DateField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Null means the cycle is still open.",
    )
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_production_cycle"
        ordering = ["pond_id", "sort_order", "-start_date", "id"]
        indexes = [
            models.Index(fields=["company", "pond", "is_active"]),
        ]

    def __str__(self):
        return f"{self.pond_id}:{self.name}"


class AquacultureExpense(models.Model):
    """
    Categorized operating expense: either direct to one pond, or shared (pond null) with explicit per-pond splits.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_expenses")
    pond = models.ForeignKey(
        AquaculturePond,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="expenses",
    )
    production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="expenses",
    )
    expense_category = models.CharField(max_length=64, db_index=True)
    expense_date = models.DateField(db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    memo = models.TextField(blank=True)
    vendor_name = models.CharField(max_length=200, blank=True)
    source_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_expenses_from_shop",
        help_text="When set, this pond cost was created from a shop stock issue at this station.",
    )
    feed_sack_count = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Optional number of feed sacks for this line (feed purchase / shop issue).",
    )
    empty_sack_count = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Empty feed sacks auto-created at the pond when feed sacks were opened (feed_consumed).",
    )
    feed_weight_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Optional total feed weight in kg (equivalent) for reporting.",
    )
    funding_account_code = models.CharField(
        max_length=20,
        blank=True,
        default="",
        help_text=(
            "When set, a manual (non-inventory, non-shop-issue) pond expense auto-posts "
            "Dr expense / Cr this funding account (e.g. 1010 Cash, 1030 Bank). "
            "Blank keeps the row register-only (cost flows to GL via Bills or inventory instead)."
        ),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_expense"
        ordering = ["-expense_date", "-id"]
        indexes = [
            models.Index(fields=["company", "pond", "expense_date"]),
            models.Index(fields=["company", "expense_date"]),
        ]


class AquacultureExpenseInventoryLine(models.Model):
    """
    Persisted inventory movements for pond consume / shop-issue expenses so delete can restore
    pond warehouse or station shop stock and drop AUTO-AQ-* journals (aligned with invoice/bill rollback).
    """

    expense = models.ForeignKey(
        AquacultureExpense,
        on_delete=models.CASCADE,
        related_name="inventory_lines",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.PROTECT,
        related_name="aquaculture_expense_inventory_lines",
    )
    quantity = models.DecimalField(max_digits=14, decimal_places=4)
    source_station = models.ForeignKey(
        "Station",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_expense_inventory_lines",
        help_text="When set, stock was taken from this station's shop (bins or QOH); when null, from the expense pond warehouse.",
    )

    class Meta:
        db_table = "aquaculture_expense_inventory_line"
        ordering = ["id"]


class AquacultureExpensePondShare(models.Model):
    """Allocated slice of a shared aquaculture expense (parent expense.pond is null)."""

    expense = models.ForeignKey(AquacultureExpense, on_delete=models.CASCADE, related_name="pond_shares")
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="aquaculture_expense_shares")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "aquaculture_expense_pond_share"
        constraints = [
            models.UniqueConstraint(fields=["expense", "pond"], name="aquaculture_exp_share_exp_pond_uniq"),
        ]


class AquacultureFishSale(models.Model):
    """Fish harvest sale: revenue with kg (primary) and optional piece count."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_fish_sales")
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="fish_sales")
    production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fish_sales",
    )
    income_type = models.CharField(
        max_length=64,
        db_index=True,
        default="fish_harvest_sale",
        help_text="Stable income line code for management P&L.",
    )
    fish_species = models.CharField(
        max_length=64,
        db_index=True,
        default="tilapia",
        help_text="Species sold on this line (polyculture); feed remains pond-level.",
    )
    fish_species_other = models.CharField(
        max_length=120,
        blank=True,
        help_text="When fish_species is 'other', optional name (e.g. local variety).",
    )
    sale_date = models.DateField(db_index=True)
    weight_kg = models.DecimalField(max_digits=14, decimal_places=4)
    fish_count = models.IntegerField(null=True, blank=True)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2)
    buyer_name = models.CharField(max_length=200, blank=True)
    memo = models.TextField(blank=True)
    invoice = models.OneToOneField(
        "Invoice",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_fish_sale",
        help_text="When set, this harvest line is booked through AR / cash sale GL (AUTO-INV-* journals).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_fish_sale"
        ordering = ["-sale_date", "-id"]
        indexes = [
            models.Index(fields=["company", "pond", "sale_date"]),
            models.Index(fields=["company", "pond", "income_type", "sale_date"]),
        ]


class AquaculturePondProfitTransfer(models.Model):
    """
    Moves value from aquaculture management P&L into the GL: debit one account, credit another
    (e.g. Dr Bank / Cr retained earnings). Creates a journal entry for the same company.
    """

    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, related_name="aquaculture_pond_profit_transfers"
    )
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="profit_transfers")
    production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="profit_transfers",
    )
    transfer_date = models.DateField(db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    debit_account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name="aquaculture_profit_transfer_debits",
    )
    credit_account = models.ForeignKey(
        ChartOfAccount,
        on_delete=models.PROTECT,
        related_name="aquaculture_profit_transfer_credits",
    )
    memo = models.TextField(blank=True)
    journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_pond_profit_transfers",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "aquaculture_pond_profit_transfer"
        ordering = ["-transfer_date", "-id"]
        indexes = [
            models.Index(fields=["company", "pond", "transfer_date"]),
        ]


class AquacultureFishPondTransfer(models.Model):
    """
    Move fish (by weight) from a source pond to one or more destination ponds — e.g. nursing to grow-out.
    Line-level cost_amount supports per-pond P&L: source pond is credited, destinations debited (management layer).
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_fish_pond_transfers")
    from_pond = models.ForeignKey(
        AquaculturePond, on_delete=models.CASCADE, related_name="fish_transfers_out"
    )
    from_production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fish_transfers_out",
    )
    transfer_date = models.DateField(db_index=True)
    fish_species = models.CharField(max_length=64, default="tilapia", db_index=True)
    fish_species_other = models.CharField(max_length=120, blank=True)
    memo = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "aquaculture_fish_pond_transfer"
        ordering = ["-transfer_date", "-id"]
        indexes = [
            models.Index(fields=["company", "from_pond", "transfer_date"]),
        ]


class AquacultureFishPondTransferLine(models.Model):
    """One destination slice of a fish pond transfer."""

    transfer = models.ForeignKey(
        AquacultureFishPondTransfer, on_delete=models.CASCADE, related_name="lines"
    )
    to_pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="fish_transfers_in")
    to_production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fish_transfers_in",
    )
    weight_kg = models.DecimalField(max_digits=14, decimal_places=4)
    fish_count = models.IntegerField(null=True, blank=True)
    pcs_per_kg = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    cost_amount = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text="BDT (or company currency) biological cost moved with this line; drives inter-pond P&L allocation.",
    )

    class Meta:
        db_table = "aquaculture_fish_pond_transfer_line"
        ordering = ["id"]
        indexes = [
            models.Index(fields=["to_pond"]),
        ]


class AquacultureBiomassSample(models.Model):
    """Estimated biomass / fish count from sampling (management; not GL inventory)."""

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_biomass_samples")
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="biomass_samples")
    production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="biomass_samples",
    )
    sample_date = models.DateField(db_index=True)
    estimated_fish_count = models.IntegerField(null=True, blank=True)
    estimated_total_weight_kg = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    avg_weight_kg = models.DecimalField(max_digits=14, decimal_places=6, null=True, blank=True)
    stock_reference_fish_count = models.IntegerField(
        null=True,
        blank=True,
        help_text="Implied net head from stock movements (Fish stock basis), snapshot at save.",
    )
    stock_reference_net_weight_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Implied net biological kg for this species, snapshot at save.",
    )
    stock_reference_avg_weight_kg = models.DecimalField(
        max_digits=14,
        decimal_places=6,
        null=True,
        blank=True,
        help_text="Reference mean kg/fish = net kg ÷ head when both positive.",
    )
    extrapolated_biomass_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Sample mean × reference head count (estimated pond biomass).",
    )
    biomass_gain_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="(sample mean − reference mean) × reference head; may be negative.",
    )
    fish_species = models.CharField(
        max_length=64,
        db_index=True,
        default="tilapia",
        help_text="Species this biomass estimate refers to (polyculture).",
    )
    fish_species_other = models.CharField(
        max_length=120,
        blank=True,
        help_text="When fish_species is 'other', optional name (e.g. local variety).",
    )
    notes = models.TextField(blank=True)
    market_price_per_kg = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Optional market price (BDT/kg) for valuation at sample time.",
    )
    market_value = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="extrapolated_biomass_kg × market_price_per_kg when both are set.",
    )
    book_bioasset_value = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Bio-asset book value (1581 settlement) snapshot at save.",
    )
    book_cost_per_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Book bio-asset ÷ on-hand kg, or production cost/kg when settlement is unavailable.",
    )
    bioasset_margin = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="market_value − book_bioasset_value.",
    )
    bioasset_margin_per_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="market_price_per_kg − book_cost_per_kg.",
    )
    biological_production_cost = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Fry, feed, medicine, preparation, and transfer-in costs in the pond/cycle window.",
    )
    full_cost_base = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Total pond/cycle costs (operating expenses + payroll) in the valuation window.",
    )
    full_cycle_margin = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="market_value − full_cost_base.",
    )
    full_cycle_margin_per_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Per-kg margin vs full_cost_base ÷ extrapolated biomass.",
    )
    source_fish_sale = models.OneToOneField(
        "AquacultureFishSale",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="biomass_sample_from_sale",
        help_text="When set, this row was auto-created from that harvest sale (head count + kg).",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_biomass_sample"
        ordering = ["-sample_date", "-id"]
        indexes = [
            models.Index(fields=["company", "pond", "sample_date"]),
        ]


class AquacultureFishStockLedger(models.Model):
    """
    Record changes to estimated fish-on-hand: mortality and losses (predators, birds, theft, etc.)
    plus manual count/weight adjustments. Optional GL pairs biological asset (1581) with expense or income.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_fish_stock_ledger")
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="fish_stock_ledger_entries")
    production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="fish_stock_ledger_entries",
    )
    entry_date = models.DateField(db_index=True)
    entry_kind = models.CharField(
        max_length=20,
        db_index=True,
        help_text="loss | adjustment — loss reasons are required for loss; adjustment allows signed count/weight.",
    )
    loss_reason = models.CharField(max_length=32, blank=True, db_index=True)
    fish_species = models.CharField(max_length=64, default="tilapia", db_index=True)
    fish_species_other = models.CharField(max_length=120, blank=True)
    fish_count_delta = models.IntegerField(default=0)
    weight_kg_delta = models.DecimalField(max_digits=14, decimal_places=4, default=0)
    book_value = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        default=0,
        help_text="Optional currency amount for GL posting (positive).",
    )
    post_to_books = models.BooleanField(default=False)
    journal_entry = models.ForeignKey(
        JournalEntry,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_fish_stock_ledger",
    )
    memo = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_fish_stock_ledger"
        ordering = ["-entry_date", "-id"]
        indexes = [
            models.Index(fields=["company", "pond", "entry_date"]),
        ]


class AquacultureFeedingAdvice(models.Model):
    """
    Heuristic / AI-style daily feeding recommendation from pond status; manager edits, approves, then applies.
    """

    STATUS_PENDING_REVIEW = "pending_review"
    STATUS_APPROVED = "approved"
    STATUS_APPLIED = "applied"
    STATUS_CANCELLED = "cancelled"

    STATUS_CHOICES = (
        (STATUS_PENDING_REVIEW, "Pending review"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_APPLIED, "Applied"),
        (STATUS_CANCELLED, "Cancelled"),
    )

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_feeding_advices")
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="feeding_advices")
    production_cycle = models.ForeignKey(
        AquacultureProductionCycle,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="feeding_advices",
    )
    target_date = models.DateField(db_index=True, help_text="Calendar day this feeding plan targets.")
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_PENDING_REVIEW, db_index=True)

    pond_status_snapshot = models.JSONField(
        default=dict,
        help_text="Pond metrics at generation time (stock position, recent feed, etc.).",
    )
    ai_advice_text = models.TextField(help_text="Original generated advisory narrative.")
    edited_advice_text = models.TextField(
        blank=True,
        help_text="Manager-edited narrative; when empty, effective text follows ai_advice_text.",
    )
    suggested_feed_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Suggested total feed (kg) for target_date; manager may override before approval.",
    )
    sack_size_kg = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Commercial sack size (kg) for field instructions; optional.",
    )

    approved_advice_text = models.TextField(blank=True, help_text="Snapshot of agreed text at approval.")
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_feeding_advices_approved",
    )

    applied_feed_kg = models.DecimalField(max_digits=14, decimal_places=4, null=True, blank=True)
    applied_at = models.DateTimeField(null=True, blank=True)
    applied_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_feeding_advices_applied",
    )
    linked_expense = models.ForeignKey(
        AquacultureExpense,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="feeding_advice",
    )

    created_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="aquaculture_feeding_advices_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "aquaculture_feeding_advice"
        ordering = ["-target_date", "-id"]
        indexes = [
            models.Index(fields=["company", "pond", "target_date"]),
            models.Index(fields=["company", "status"]),
        ]


class AquacultureDataBankPondClose(models.Model):
    """
    Per-pond fiscal year close: archives operational data for the period; pond structure
    (Site & lease) is unchanged. Farmers record the next season with dates after period_end.
    Admin may reopen for read-only reference in Data Bank.
    """

    STATUS_CLOSED = "closed"

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="aquaculture_data_bank_pond_closes")
    pond = models.ForeignKey(
        AquaculturePond,
        on_delete=models.CASCADE,
        related_name="data_bank_closes",
    )
    label = models.CharField(max_length=120, help_text="Display label, e.g. Pond A — FY 2025.")
    period_start = models.DateField()
    period_end = models.DateField(help_text="Year-end / close date chosen for this pond.")
    status = models.CharField(max_length=16, default=STATUS_CLOSED, db_index=True)
    is_data_locked = models.BooleanField(
        default=True,
        help_text="When true, operational writes for this pond are blocked.",
    )
    reference_access_enabled = models.BooleanField(
        default=False,
        help_text="Admin reopened this close in Data Bank for historical reference (read-only).",
    )
    closed_at = models.DateTimeField(auto_now_add=True)
    closed_by_user_id = models.IntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    # Biological settlement snapshot captured at close: remaining live fish (count + kg) and the
    # bio-asset (1581) book value tagged to this pond as of period_end. Recorded for audit/closing;
    # books are not auto-written-off (residual biomass carries to the next cycle unless harvested).
    settlement_fish_count = models.IntegerField(
        null=True,
        blank=True,
        help_text="Implied remaining headcount in the pond at close (period_end).",
    )
    settlement_weight_kg = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Implied remaining live-fish weight (kg) in the pond at close.",
    )
    settlement_bioasset_value = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Bio-asset (1581) book value tagged to this pond as of period_end.",
    )
    reopened_at = models.DateTimeField(null=True, blank=True)
    reopened_by_user_id = models.IntegerField(null=True, blank=True)
    reopen_reason = models.TextField(blank=True)
    relocked_at = models.DateTimeField(null=True, blank=True)
    relocked_by_user_id = models.IntegerField(null=True, blank=True)

    class Meta:
        db_table = "aquaculture_data_bank_pond_close"
        ordering = ["-period_end", "-id"]
        indexes = [
            models.Index(fields=["company", "pond", "period_end"]),
            models.Index(fields=["pond", "is_data_locked"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["pond", "period_end"],
                name="uq_aquaculture_data_bank_pond_close_pond_end",
            ),
        ]

    def __str__(self):
        return f"{self.label} ({self.period_start} – {self.period_end})"


class PayrollRunPondAllocation(models.Model):
    """
    Attribute payroll wages to aquaculture ponds (pond P&L labor and GL 6712 splits).
    Sum of amounts for a payroll run should match PayrollRun.total_gross (enforced in API).
    """

    payroll_run = models.ForeignKey(PayrollRun, on_delete=models.CASCADE, related_name="pond_allocations")
    pond = models.ForeignKey(AquaculturePond, on_delete=models.CASCADE, related_name="payroll_allocations")
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "payroll_run_pond_allocation"
        unique_together = [["payroll_run", "pond"]]
        indexes = [
            models.Index(fields=["pond"]),
        ]


class PayrollRunEmployeeAllocation(models.Model):
    """
    Attribute payroll gross wages to named employees (HR subledger and payroll audit trail).
    Sum of amounts should match the portion of PayrollRun.total_gross attributed to listed staff.
    """

    payroll_run = models.ForeignKey(
        PayrollRun, on_delete=models.CASCADE, related_name="employee_allocations"
    )
    employee = models.ForeignKey(
        Employee, on_delete=models.CASCADE, related_name="payroll_wage_allocations"
    )
    amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        db_table = "payroll_run_employee_allocation"
        unique_together = [["payroll_run", "employee"]]
        indexes = [
            models.Index(fields=["employee"]),
        ]
