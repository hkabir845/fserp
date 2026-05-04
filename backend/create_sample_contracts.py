"""
Script to create sample contracts for testing
Run this from the backend directory: python create_sample_contracts.py
"""
import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from datetime import date, timedelta
from decimal import Decimal
from app.database import SessionLocal
from app.models.contract import Contract, ContractStatus, BillingPeriod
from app.models.company import Company

def create_sample_contracts():
    db = SessionLocal()
    try:
        # Get all active companies
        companies = db.query(Company).filter(Company.is_deleted == False).all()
        
        if not companies:
            print("No companies found. Please create companies first.")
            return
        
        print(f"Found {len(companies)} companies. Creating sample contracts...")
        
        # Contract data for each company
        sample_contracts = [
            {
                "status": ContractStatus.ACTIVE,
                "billing_period": BillingPeriod.MONTHLY,
                "amount_per_month": Decimal("50000.00"),
                "total_contract_value": Decimal("600000.00"),
                "duration_years": 1,
                "license_type": "Premium",
                "notes": "Sample active contract for testing"
            },
            {
                "status": ContractStatus.DRAFT,
                "billing_period": BillingPeriod.YEARLY,
                "amount_per_year": Decimal("500000.00"),
                "total_contract_value": Decimal("500000.00"),
                "duration_years": 1,
                "license_type": "Standard",
                "notes": "Sample draft contract"
            },
            {
                "status": ContractStatus.ACTIVE,
                "billing_period": BillingPeriod.MONTHLY,
                "amount_per_month": Decimal("75000.00"),
                "total_contract_value": Decimal("900000.00"),
                "duration_years": 2,
                "license_type": "Enterprise",
                "notes": "Sample enterprise contract"
            }
        ]
        
        contracts_created = 0
        
        for idx, company in enumerate(companies[:3]):  # Create contracts for first 3 companies
            if idx >= len(sample_contracts):
                break
                
            contract_data = sample_contracts[idx]
            
            # Calculate dates
            today = date.today()
            contract_date = today
            expiry_date = today + timedelta(days=365 * contract_data["duration_years"])
            
            # Generate unique contract number
            year = today.year
            # Get the highest existing contract number for this year
            last_contract = db.query(Contract).filter(
                Contract.contract_number.like(f"CNT-{year}-%")
            ).order_by(Contract.contract_number.desc()).first()
            
            if last_contract:
                try:
                    # Extract sequence number from last contract
                    seq = int(last_contract.contract_number.split('-')[-1])
                    seq += 1
                except (ValueError, IndexError):
                    seq = 1
            else:
                seq = 1
            
            contract_number = f"CNT-{year}-{seq:04d}"
            
            # Check if contract number already exists (double check)
            existing = db.query(Contract).filter(
                Contract.contract_number == contract_number
            ).first()
            
            if existing:
                # If exists, increment and try again
                seq += 1
                contract_number = f"CNT-{year}-{seq:04d}"
            
            # Create contract
            contract = Contract(
                company_id=company.id,
                contract_number=contract_number,
                contract_date=contract_date,
                expiry_date=expiry_date,
                duration_years=contract_data["duration_years"],
                status=contract_data["status"],
                license_type=contract_data["license_type"],
                billing_period=contract_data["billing_period"],
                amount_per_month=contract_data.get("amount_per_month"),
                amount_per_year=contract_data.get("amount_per_year"),
                currency="BDT",
                total_contract_value=contract_data["total_contract_value"],
                broadcast_message=f"New contract created for {company.name}",
                payment_reminder_message=f"Payment reminder for {company.name}",
                terms_and_conditions="Standard terms and conditions apply.",
                notes=contract_data["notes"],
                auto_renewal="true"
            )
            
            db.add(contract)
            db.flush()  # Flush to get the ID and check for errors
            contracts_created += 1
            print(f"[OK] Created contract {contract_number} for {company.name} (Status: {contract_data['status'].value})")
        
        db.commit()
        print(f"\n[SUCCESS] Successfully created {contracts_created} sample contracts!")
        print("Refresh the contracts page to see them.")
        
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Error creating contracts: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    create_sample_contracts()

