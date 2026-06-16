"""Quick verification of Master Company production orders"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.session import SessionLocal

def verify():
    db = SessionLocal()
    try:
        result = db.execute(text("""
            SELECT 
                po.id, po.order_number, po.status, 
                po.batch_size_ton, po.planned_date,
                fb.bom_code, fb.version
            FROM production_orders po
            JOIN tenants t ON po.tenant_id = t.id
            LEFT JOIN feed_boms fb ON po.bom_id = fb.id
            WHERE t.domain = 'master'
            ORDER BY po.status, po.id
        """))
        
        orders = result.fetchall()
        
        print(f"\n{'='*70}")
        print(f"MASTER COMPANY PRODUCTION ORDERS")
        print(f"{'='*70}\n")
        print(f"Total Orders: {len(orders)}\n")
        
        # Group by status
        by_status = {}
        for order in orders:
            status = order[2]
            if status not in by_status:
                by_status[status] = []
            by_status[status].append(order)
        
        for status in ['draft', 'planned', 'in_progress', 'completed', 'cancelled']:
            if status in by_status:
                print(f"{status.upper()} ({len(by_status[status])}):")
                for order in by_status[status]:
                    print(f"  {order[1]} - {order[5]} v{order[6]} ({order[3]} ton)")
                print()
        
    finally:
        db.close()

if __name__ == "__main__":
    verify()
