"""
Script to add dummy customers (cash and credit) to the database
Run this script to populate the database with sample customers
"""
import sys
from datetime import date
from decimal import Decimal
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.customer import Customer
from app.models.company import Company
from app.models.user import User
from app.utils.auto_numbering import generate_customer_number


def add_dummy_customers(db: Session, company_id: int):
    """Add dummy customers to the database"""
    print("\n" + "="*60)
    print("Adding Dummy Customers to Database")
    print("="*60)
    
    # Check if customers already exist
    existing_count = db.query(Customer).filter(
        Customer.company_id == company_id,
        Customer.is_deleted == False
    ).count()
    
    if existing_count > 0:
        print(f"\n⚠️  Found {existing_count} existing customers in database.")
        response = input("Do you want to add more customers? (y/n): ").strip().lower()
        if response != 'y':
            print("Skipping customer creation.")
            return
    
    # Define dummy customers - Mix of cash and credit customers
    dummy_customers = [
        # Cash Customers (no outstanding balance, pay immediately)
        {
            "company_name": "Quick Cash Transport",
            "first_name": None,
            "display_name": "Quick Cash Transport",
            "email": "quickcash@transport.com",
            "phone": "+1-555-2001",
            "opening_balance": Decimal("0.00"),
            "current_balance": Decimal("0.00"),
            "payment_terms": "Due on Receipt",
            "credit_limit": Decimal("0.00"),
            "is_active": True,
            "billing_address_line1": "123 Cash Street",
            "billing_city": "Metro City",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": None,
            "first_name": "Sarah",
            "last_name": "Johnson",
            "display_name": "Sarah Johnson",
            "email": "sarah.johnson@email.com",
            "phone": "+1-555-2002",
            "opening_balance": Decimal("0.00"),
            "current_balance": Decimal("0.00"),
            "payment_terms": "Cash on Delivery",
            "credit_limit": Decimal("0.00"),
            "is_active": True,
            "billing_address_line1": "456 Personal Ave",
            "billing_city": "Suburb",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": "Instant Pay Services",
            "first_name": None,
            "display_name": "Instant Pay Services",
            "email": "info@instantpay.com",
            "phone": "+1-555-2003",
            "opening_balance": Decimal("0.00"),
            "current_balance": Decimal("0.00"),
            "payment_terms": "Immediate Payment",
            "credit_limit": Decimal("0.00"),
            "is_active": True,
            "billing_address_line1": "789 Payment Blvd",
            "billing_city": "Business District",
            "billing_state": "State",
            "billing_country": "USA"
        },
        
        # Credit Customers (with outstanding balances)
        {
            "company_name": "ABC Transport Co.",
            "first_name": None,
            "display_name": "ABC Transport Co.",
            "email": "accounts@abctransport.com",
            "phone": "+1-555-3001",
            "opening_balance": Decimal("5000.00"),
            "current_balance": Decimal("5000.00"),
            "payment_terms": "Net 30",
            "credit_limit": Decimal("10000.00"),
            "is_active": True,
            "billing_address_line1": "100 Transport Way",
            "billing_city": "Industrial Park",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": "XYZ Logistics Ltd",
            "first_name": None,
            "display_name": "XYZ Logistics Ltd",
            "email": "finance@xyzlogistics.com",
            "phone": "+1-555-3002",
            "opening_balance": Decimal("12500.50"),
            "current_balance": Decimal("12500.50"),
            "payment_terms": "Net 15",
            "credit_limit": Decimal("20000.00"),
            "is_active": True,
            "billing_address_line1": "200 Logistics Drive",
            "billing_city": "Port City",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": None,
            "first_name": "Michael",
            "last_name": "Chen",
            "display_name": "Michael Chen",
            "email": "michael.chen@email.com",
            "phone": "+1-555-3003",
            "opening_balance": Decimal("2500.75"),
            "current_balance": Decimal("2500.75"),
            "payment_terms": "Net 30",
            "credit_limit": Decimal("5000.00"),
            "is_active": True,
            "billing_address_line1": "300 Business Center",
            "billing_city": "Downtown",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": "Premium Fleet Services",
            "first_name": None,
            "display_name": "Premium Fleet Services",
            "email": "billing@premiumfleet.com",
            "phone": "+1-555-3004",
            "opening_balance": Decimal("8750.00"),
            "current_balance": Decimal("8750.00"),
            "payment_terms": "Net 45",
            "credit_limit": Decimal("15000.00"),
            "is_active": True,
            "billing_address_line1": "400 Fleet Avenue",
            "billing_city": "Transport Hub",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": "City Delivery Express",
            "first_name": None,
            "display_name": "City Delivery Express",
            "email": "accounts@citydelivery.com",
            "phone": "+1-555-3005",
            "opening_balance": Decimal("3200.25"),
            "current_balance": Decimal("3200.25"),
            "payment_terms": "Net 30",
            "credit_limit": Decimal("8000.00"),
            "is_active": True,
            "billing_address_line1": "500 Express Lane",
            "billing_city": "Urban Center",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": None,
            "first_name": "Robert",
            "last_name": "Williams",
            "display_name": "Robert Williams",
            "email": "robert.williams@email.com",
            "phone": "+1-555-3006",
            "opening_balance": Decimal("1500.00"),
            "current_balance": Decimal("1500.00"),
            "payment_terms": "Net 15",
            "credit_limit": Decimal("3000.00"),
            "is_active": True,
            "billing_address_line1": "600 Residential Road",
            "billing_city": "Suburban Area",
            "billing_state": "State",
            "billing_country": "USA"
        },
        
        # Mixed - Some with credit, some paid
        {
            "company_name": "Reliable Transport Inc",
            "first_name": None,
            "display_name": "Reliable Transport Inc",
            "email": "info@reliabletransport.com",
            "phone": "+1-555-4001",
            "opening_balance": Decimal("0.00"),
            "current_balance": Decimal("4500.00"),  # Current balance but no opening
            "payment_terms": "Net 30",
            "credit_limit": Decimal("12000.00"),
            "is_active": True,
            "billing_address_line1": "700 Reliability Street",
            "billing_city": "Business Park",
            "billing_state": "State",
            "billing_country": "USA"
        },
        {
            "company_name": "Fast Track Logistics",
            "first_name": None,
            "display_name": "Fast Track Logistics",
            "email": "billing@fasttrack.com",
            "phone": "+1-555-4002",
            "opening_balance": Decimal("10000.00"),
            "current_balance": Decimal("7500.00"),  # Paid some
            "payment_terms": "Net 30",
            "credit_limit": Decimal("25000.00"),
            "is_active": True,
            "billing_address_line1": "800 Speedway",
            "billing_city": "Logistics Center",
            "billing_state": "State",
            "billing_country": "USA"
        }
    ]
    
    created_customers = []
    for idx, cust_data in enumerate(dummy_customers):
        try:
            # Generate customer number
            customer_number = generate_customer_number(db, company_id)
            
            customer = Customer(
                customer_number=customer_number,
                company_name=cust_data.get("company_name") or "",
                first_name=cust_data.get("first_name"),
                last_name=cust_data.get("last_name"),
                display_name=cust_data.get("display_name"),
                email=cust_data.get("email"),
                phone=cust_data.get("phone"),
                opening_balance=cust_data.get("opening_balance", Decimal("0.00")),
                opening_balance_date=date.today(),
                current_balance=cust_data.get("current_balance", Decimal("0.00")),
                payment_terms=cust_data.get("payment_terms"),
                credit_limit=cust_data.get("credit_limit"),
                is_active=cust_data.get("is_active", True),
                billing_address_line1=cust_data.get("billing_address_line1"),
                billing_city=cust_data.get("billing_city"),
                billing_state=cust_data.get("billing_state"),
                billing_country=cust_data.get("billing_country"),
                company_id=company_id
            )
            
            db.add(customer)
            created_customers.append(customer)
            print(f"✓ Created customer: {customer.display_name} ({customer.customer_number}) - Balance: {customer.current_balance}")
            
        except Exception as e:
            print(f"✗ Error creating customer {cust_data.get('display_name')}: {str(e)}")
            continue
    
    try:
        db.commit()
        print(f"\n✅ Successfully created {len(created_customers)} customers!")
        
        # Summary
        cash_customers = [c for c in created_customers if c.current_balance == 0]
        credit_customers = [c for c in created_customers if c.current_balance > 0]
        total_receivables = sum([c.current_balance for c in created_customers])
        
        print("\n" + "-"*60)
        print("Summary:")
        print(f"  Total Customers: {len(created_customers)}")
        print(f"  Cash Customers (no balance): {len(cash_customers)}")
        print(f"  Credit Customers (with balance): {len(credit_customers)}")
        print(f"  Total Receivables: ${total_receivables:,.2f}")
        print("-"*60)
        
    except Exception as e:
        db.rollback()
        print(f"\n✗ Error committing customers to database: {str(e)}")
        raise


def main():
    """Main function"""
    db = SessionLocal()
    try:
        # Get the first company (or you can modify to get by name/ID)
        company = db.query(Company).first()
        if not company:
            print("❌ No company found in database. Please create a company first.")
            sys.exit(1)
        
        print(f"Using company: {company.name} (ID: {company.id})")
        
        # Add dummy customers
        add_dummy_customers(db, company.id)
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()

