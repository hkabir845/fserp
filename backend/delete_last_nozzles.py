"""
Script to delete the last 4 nozzles from the database
This helps test dynamic sizing of nozzle cards
"""
import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models.nozzle import Nozzle

def delete_last_nozzles():
    """Delete the last 4 nozzles (by ID) from the database"""
    db: Session = SessionLocal()
    
    try:
        # Get all nozzles ordered by ID descending (to get the last ones)
        all_nozzles = db.query(Nozzle).order_by(Nozzle.id.desc()).all()
        
        if len(all_nozzles) < 4:
            print(f"⚠️  Only {len(all_nozzles)} nozzles found. Cannot delete 4.")
            return
        
        # Get the last 4 nozzles
        nozzles_to_delete = all_nozzles[:4]
        
        print(f"Found {len(all_nozzles)} total nozzles")
        print(f"\n🗑️  Deleting the last 4 nozzles:")
        
        for nozzle in nozzles_to_delete:
            print(f"  - {nozzle.nozzle_name} (ID: {nozzle.id}, Number: {nozzle.nozzle_number})")
            db.delete(nozzle)
        
        db.commit()
        print(f"\n✅ Successfully deleted {len(nozzles_to_delete)} nozzles")
        print(f"📊 Remaining nozzles: {len(all_nozzles) - len(nozzles_to_delete)}")
        
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {str(e)}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    print("=" * 60)
    print("Delete Last 4 Nozzles Script")
    print("=" * 60)
    delete_last_nozzles()






