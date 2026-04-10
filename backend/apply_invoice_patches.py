#!/usr/bin/env python
"""
Script to apply invoice schema patches directly to the database
"""
import sys
from app.database import engine
from app.utils.schema_patches import apply_schema_patches

def main():
    print("Applying invoice schema patches...")
    try:
        apply_schema_patches(engine)
        print("✓ Schema patches applied successfully")
        
        # Verify the columns exist
        from sqlalchemy import inspect
        inspector = inspect(engine)
        if "invoice" in inspector.get_table_names():
            columns = [col["name"] for col in inspector.get_columns("invoice")]
            required_columns = ["source", "pos_receipt_number", "pos_session_id", "discount_amount", "amount_paid"]
            missing = [col for col in required_columns if col not in columns]
            if missing:
                print(f"✗ Missing columns: {missing}")
                return 1
            else:
                print(f"✓ All required columns exist: {required_columns}")
        return 0
    except Exception as e:
        print(f"✗ Error applying patches: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())

