"""Quick script to check where sample tank data is stored"""
from app.database import SessionLocal
from app.models.tank import Tank
from app.models.company import Company

db = SessionLocal()

try:
    # Get all tanks
    tanks = db.query(Tank).all()
    companies = db.query(Company).all()
    
    print("=" * 60)
    print("SAMPLE TANK DATA LOCATION")
    print("=" * 60)
    print(f"\nTotal Tanks in Database: {len(tanks)}")
    print(f"Total Companies: {len(companies)}")
    
    print("\n" + "-" * 60)
    print("TANKS BY COMPANY:")
    print("-" * 60)
    
    if len(tanks) == 0:
        print("❌ NO TANKS FOUND in database!")
        print("\nTo create sample tanks, run:")
        print("  python init_database.py")
    else:
        for tank in tanks:
            company = db.query(Company).filter(Company.id == tank.company_id).first()
            company_name = company.name if company else f"Company ID {tank.company_id} (not found)"
            print(f"\n  Tank: {tank.tank_number}")
            print(f"    Name: {tank.tank_name}")
            print(f"    Company: {company_name} (ID: {tank.company_id})")
            print(f"    Capacity: {tank.capacity} Liters")
            print(f"    Current Stock: {tank.current_stock} Liters")
    
    print("\n" + "-" * 60)
    print("COMPANIES:")
    print("-" * 60)
    for comp in companies:
        tank_count = db.query(Tank).filter(Tank.company_id == comp.id).count()
        print(f"  Company ID {comp.id}: {comp.name} ({tank_count} tanks)")
    
    print("\n" + "=" * 60)
    print("TO SEE TANKS IN THE APP:")
    print("=" * 60)
    print("\n1. ⚠️ Cannot connect to backend server")
    print("   Please ensure the backend is running on https://localhost:8000")
    print("   💡 Tip: Run 'python -m uvicorn app.main:app --reload' in the backend directory")
    print("\n2. Login with your domain-based tenant account")
    print("   (This is a domain-based multi-tenant application)")
    print("\n3. If you're a Super Admin:")
    print("   - Select the company from the company switcher")
    print("   - Switch to 'FSMS ERP' mode")
    print("\n4. Go to: http://localhost:3000/tanks")
    print("=" * 60)
    
finally:
    db.close()
