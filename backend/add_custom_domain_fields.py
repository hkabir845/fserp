"""
Migration Script: Add custom domain fields to company table
"""
from sqlalchemy import text
from app.database import SessionLocal, engine

def add_custom_domain_fields():
    """Add custom_domain and domain_status columns to company table"""
    db = SessionLocal()
    try:
        # Check if columns exist (SQLite specific)
        if 'sqlite' in str(engine.url):
            # SQLite: Check if columns exist
            result = db.execute(text("PRAGMA table_info(company)"))
            columns = [row[1] for row in result]
            
            if 'custom_domain' not in columns:
                print("Adding 'custom_domain' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN custom_domain VARCHAR(255)"))
                db.commit()
                print("✅ Column 'custom_domain' added successfully")
            else:
                print("✅ Column 'custom_domain' already exists")
            
            if 'domain_status' not in columns:
                print("Adding 'domain_status' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN domain_status VARCHAR(20) DEFAULT 'pending' NOT NULL"))
                db.commit()
                print("✅ Column 'domain_status' added successfully")
            else:
                print("✅ Column 'domain_status' already exists")
            
            if 'domain_verified_at' not in columns:
                print("Adding 'domain_verified_at' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN domain_verified_at DATETIME"))
                db.commit()
                print("✅ Column 'domain_verified_at' added successfully")
            else:
                print("✅ Column 'domain_verified_at' already exists")
        else:
            # PostgreSQL: Use information_schema
            result = db.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'company' AND column_name IN ('custom_domain', 'domain_status', 'domain_verified_at')
            """))
            
            existing_columns = [row[0] for row in result]
            
            if 'custom_domain' not in existing_columns:
                print("Adding 'custom_domain' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN custom_domain VARCHAR(255)"))
                db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_company_custom_domain ON company(custom_domain) WHERE custom_domain IS NOT NULL"))
                db.commit()
                print("✅ Column 'custom_domain' added successfully")
            else:
                print("✅ Column 'custom_domain' already exists")
            
            if 'domain_status' not in existing_columns:
                print("Adding 'domain_status' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN domain_status VARCHAR(20) DEFAULT 'pending' NOT NULL"))
                db.commit()
                print("✅ Column 'domain_status' added successfully")
            else:
                print("✅ Column 'domain_status' already exists")
            
            if 'domain_verified_at' not in existing_columns:
                print("Adding 'domain_verified_at' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN domain_verified_at TIMESTAMP"))
                db.commit()
                print("✅ Column 'domain_verified_at' added successfully")
            else:
                print("✅ Column 'domain_verified_at' already exists")
        
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    add_custom_domain_fields()


