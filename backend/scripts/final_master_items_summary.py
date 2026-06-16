"""Final summary of Master Company items"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.session import SessionLocal

def summary():
    db = SessionLocal()
    try:
        result = db.execute(text("SELECT id FROM tenants WHERE domain = 'master'"))
        tenant_id = result.fetchone()[0]
        
        # Items by type
        result = db.execute(text("""
            SELECT type, COUNT(*) 
            FROM items 
            WHERE tenant_id = :tenant_id 
            GROUP BY type
        """), {"tenant_id": tenant_id})
        
        print(f"\n{'='*70}")
        print(f"MASTER COMPANY - FINAL ITEMS SUMMARY")
        print(f"{'='*70}\n")
        
        total = 0
        for row in result.fetchall():
            print(f"  {row[0]}: {row[1]} items")
            total += row[1]
        print(f"\n  TOTAL: {total} items\n")
        
        # Raw materials with ingredients
        result = db.execute(text("""
            SELECT COUNT(DISTINCT i.id) as total, COUNT(DISTINCT ing.id) as with_ing
            FROM items i
            LEFT JOIN ingredients ing ON i.id = ing.item_id AND ing.tenant_id = i.tenant_id
            WHERE i.tenant_id = :tenant_id AND i.type = 'raw_material'
        """), {"tenant_id": tenant_id})
        rm_stats = result.fetchone()
        print(f"Raw Materials: {rm_stats[0]} total, {rm_stats[1]} with ingredients")
        print(f"  Coverage: {100 * rm_stats[1] / rm_stats[0] if rm_stats[0] > 0 else 0:.1f}%\n")
        
        # Finished goods with feed products
        result = db.execute(text("""
            SELECT COUNT(DISTINCT i.id) as total, COUNT(DISTINCT fp.id) as with_fp
            FROM items i
            LEFT JOIN feed_products fp ON i.id = fp.item_id AND fp.tenant_id = i.tenant_id
            WHERE i.tenant_id = :tenant_id AND i.type = 'finished_good'
        """), {"tenant_id": tenant_id})
        fg_stats = result.fetchone()
        print(f"Finished Goods: {fg_stats[0]} total, {fg_stats[1]} with feed products")
        print(f"  Coverage: {100 * fg_stats[1] / fg_stats[0] if fg_stats[0] > 0 else 0:.1f}%\n")
        
        # Fish and Poultry items
        result = db.execute(text("""
            SELECT COUNT(*) 
            FROM items i
            LEFT JOIN feed_products fp ON i.id = fp.item_id AND fp.tenant_id = i.tenant_id
            WHERE i.tenant_id = :tenant_id 
            AND i.type = 'finished_good'
            AND fp.category IN ('Fish', 'Poultry')
        """), {"tenant_id": tenant_id})
        fish_poultry = result.fetchone()[0]
        print(f"Fish & Poultry Feed Products: {fish_poultry}\n")
        
    finally:
        db.close()

if __name__ == "__main__":
    summary()
