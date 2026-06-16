"""One-click demo seed for factory workflow (tenant-scoped).

Populates:
- Inventory demo (warehouses/items/stock ledger)
- Feed manufacturing demo (ingredients, feed products, BOMs)
- Production orders + stock balances (so Issue → Complete → Pack works)

Idempotency:
- Each underlying script is written to be safe to re-run (creates missing masters, adds demo batches).

Usage:
  python scripts/seed_demo_factory.py

Optional:
  Set TENANT_DOMAIN env var (default: localhost)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run_script(mod_name: str):
    __import__(mod_name)


def main():
    print("\n=== FMERP Demo Seeder (Factory Workflow) ===\n")
    domain = os.environ.get("TENANT_DOMAIN") or "localhost"
    print(f"[INFO] Target tenant domain: {domain}")

    # Inventory baseline
    print("[1/3] Seeding inventory demo...")
    from scripts.seed_inventory_demo import seed_inventory_demo

    seed_inventory_demo(domain=domain)

    # Feed manufacturing (products/ingredients/boms)
    print("\n[2/3] Seeding feed manufacturing demo...")
    from scripts.seed_feed_manufacturing import seed_feed_manufacturing

    seed_feed_manufacturing(domain=domain)

    # Production orders + balances
    print("\n[3/3] Seeding production orders + balances demo...")
    from scripts.seed_production_orders_demo import seed_production_orders_demo

    seed_production_orders_demo(domain=domain)

    print("\n[SUCCESS] Demo data seeded. You can now use:")
    print("- /manufacturing/feed-boms")
    print("- /manufacturing/feed-boms/new")
    print("- /manufacturing/production-orders")
    print("- /manufacturing/production-orders/{id} (Issue -> Complete -> Pack)")


if __name__ == "__main__":
    main()

