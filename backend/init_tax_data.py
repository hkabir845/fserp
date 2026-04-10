"""
Initialize Tax Data for Testing
Creates tax codes and rates if they don't exist
"""
from decimal import Decimal
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Company, TaxCode, TaxRate

def init_tax_data(company_id: int = None):
    """Initialize tax codes and rates for a company"""
    db = SessionLocal()
    
    try:
        if company_id is None:
            # Get first company
            company = db.query(Company).first()
            if not company:
                print("[ERROR] No company found")
                return
            company_id = company.id
            print(f"[OK] Using company: {company.name} (ID: {company_id})")
        
        # Check if tax codes already exist
        existing_codes = db.query(TaxCode).filter(
            TaxCode.company_id == company_id
        ).count()
        
        if existing_codes > 0:
            print(f"[OK] {existing_codes} tax code(s) already exist")
            # Check for active rates
            active_rates = db.query(TaxRate).join(TaxCode).filter(
                TaxCode.company_id == company_id,
                TaxRate.is_active == True
            ).count()
            
            if active_rates > 0:
                print(f"[OK] {active_rates} active tax rate(s) found")
                return
            else:
                print("[WARNING] No active tax rates found. Creating rates...")
        
        # Create standard tax codes
        tax_codes_data = [
            {
                "code": "VAT-15",
                "name": "Value Added Tax",
                "tax_type": "VAT",
                "description": "Standard VAT rate for fuel sales",
                "rates": [
                    {"name": "Standard VAT Rate", "rate": Decimal("15.00"), "agency": "NBR"}
                ]
            },
            {
                "code": "SD-PETROL",
                "name": "Supplementary Duty - Petrol",
                "tax_type": "SD",
                "description": "Supplementary Duty on Petrol/Octane",
                "rates": [
                    {"name": "Petrol SD Rate", "rate": Decimal("37.00"), "agency": "NBR"}
                ]
            },
            {
                "code": "SD-DIESEL",
                "name": "Supplementary Duty - Diesel",
                "tax_type": "SD",
                "description": "Supplementary Duty on Diesel",
                "rates": [
                    {"name": "Diesel SD Rate", "rate": Decimal("20.00"), "agency": "NBR"}
                ]
            },
            {
                "code": "AIT",
                "name": "Advance Income Tax",
                "tax_type": "AIT",
                "description": "Advance Income Tax on certain transactions",
                "rates": [
                    {"name": "Standard AIT Rate", "rate": Decimal("3.00"), "agency": "NBR"}
                ]
            }
        ]
        
        created_codes = 0
        created_rates = 0
        
        for tax_data in tax_codes_data:
            # Check if code already exists
            existing = db.query(TaxCode).filter(
                TaxCode.code == tax_data["code"],
                TaxCode.company_id == company_id
            ).first()
            
            if existing:
                print(f"  [SKIP] Tax code '{tax_data['code']}' already exists")
                tax_code = existing
            else:
                tax_code = TaxCode(
                    code=tax_data["code"],
                    name=tax_data["name"],
                    tax_type=tax_data["tax_type"],
                    description=tax_data["description"],
                    is_active=True,
                    company_id=company_id
                )
                db.add(tax_code)
                db.flush()
                created_codes += 1
                print(f"  [OK] Created tax code: {tax_code.code}")
            
            # Add tax rates
            for rate_data in tax_data.get("rates", []):
                # Check if rate already exists
                existing_rate = db.query(TaxRate).filter(
                    TaxRate.tax_code_id == tax_code.id,
                    TaxRate.name == rate_data["name"]
                ).first()
                
                if existing_rate:
                    if not existing_rate.is_active:
                        existing_rate.is_active = True
                        print(f"    [OK] Activated rate: {rate_data['name']}")
                    else:
                        print(f"    [SKIP] Rate '{rate_data['name']}' already exists and is active")
                else:
                    tax_rate = TaxRate(
                        name=rate_data["name"],
                        rate=rate_data["rate"],
                        tax_agency=rate_data["agency"],
                        tax_code_id=tax_code.id,
                        is_active=True,
                        company_id=company_id
                    )
                    db.add(tax_rate)
                    created_rates += 1
                    print(f"    [OK] Created rate: {rate_data['name']} ({rate_data['rate']}%)")
        
        db.commit()
        
        print(f"\n[OK] Summary:")
        print(f"  - Created {created_codes} tax code(s)")
        print(f"  - Created {created_rates} tax rate(s)")
        print(f"[SUCCESS] Tax data initialized successfully")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    print("="*60)
    print("INITIALIZE TAX DATA")
    print("="*60)
    init_tax_data()

