"""
Migration Script: Add subdomain column to company table
"""
from sqlalchemy import text
from app.database import SessionLocal, engine

def add_subdomain_column():
    """Add subdomain column to company table if it doesn't exist"""
    db = SessionLocal()
    try:
        # Check if column exists (SQLite specific)
        if 'sqlite' in str(engine.url):
            # SQLite: Check if column exists
            result = db.execute(text("PRAGMA table_info(company)"))
            columns = [row[1] for row in result]
            
            if 'subdomain' not in columns:
                print("Adding 'subdomain' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN subdomain VARCHAR(100)"))
                db.commit()
                print("✅ Column 'subdomain' added successfully")
            else:
                print("✅ Column 'subdomain' already exists")
        else:
            # PostgreSQL: Use information_schema
            result = db.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'company' AND column_name = 'subdomain'
            """))
            
            if not result.fetchone():
                print("Adding 'subdomain' column to company table...")
                db.execute(text("ALTER TABLE company ADD COLUMN subdomain VARCHAR(100)"))
                db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_company_subdomain ON company(subdomain)"))
                db.commit()
                print("✅ Column 'subdomain' added successfully")
            else:
                print("✅ Column 'subdomain' already exists")
        
        # Generate subdomains for existing companies
        print("\nGenerating subdomains for existing companies...")
        companies = db.execute(text("SELECT id, name FROM company WHERE subdomain IS NULL")).fetchall()
        
        for company_id, company_name in companies:
            # Generate subdomain from company name
            subdomain = company_name.lower()
            # Remove special characters, keep only alphanumeric and hyphens
            import re
            subdomain = re.sub(r'[^a-z0-9-]', '', subdomain)
            subdomain = re.sub(r'-+', '-', subdomain)  # Replace multiple hyphens with single
            subdomain = subdomain.strip('-')  # Remove leading/trailing hyphens
            
            # Ensure it's not empty and make it unique
            if not subdomain:
                subdomain = f"company{company_id}"
            
            # Check if subdomain already exists
            existing = db.execute(
                text("SELECT id FROM company WHERE subdomain = :subdomain"),
                {"subdomain": subdomain}
            ).fetchone()
            
            if existing:
                subdomain = f"{subdomain}{company_id}"
            
            # Update company with subdomain
            db.execute(
                text("UPDATE company SET subdomain = :subdomain WHERE id = :id"),
                {"subdomain": subdomain, "id": company_id}
            )
            print(f"  ✅ Company {company_id} ({company_name}) -> subdomain: {subdomain}")
        
        db.commit()
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    add_subdomain_column()


