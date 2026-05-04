"""
Copy all sample data from Adib Filling Station to Master Company
This script copies all data that belongs to Adib Filling Station to the Master company
"""
import sys
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import *

def get_companies(db: Session):
    """Get Adib Filling Station and Master company"""
    adib_company = db.query(Company).filter(
        Company.name.like("%Adib%")
    ).first()
    
    master_company = db.query(Company).filter(
        Company.is_master == "true"
    ).first()
    
    if not adib_company:
        print("❌ ERROR: Adib Filling Station company not found!")
        return None, None
    
    if not master_company:
        print("❌ ERROR: Master company not found!")
        print("   Creating Master company...")
        master_company = Company(
            name="Master Company",
            legal_name="Master Company Limited",
            tax_id="MASTER-001",
            email="master@master.com",
            phone="+1-555-0000",
            address_line1="Master Address",
            city="Master City",
            state="Master State",
            postal_code="00000",
            country="USA",
            currency="USD",
            fiscal_year_start="01-01",
            is_master="true"
        )
        db.add(master_company)
        db.flush()
        print(f"✅ Created Master company: {master_company.id}")
    
    print(f"\n📋 Companies:")
    print(f"   Adib Filling Station: ID {adib_company.id}")
    print(f"   Master Company: ID {master_company.id}")
    
    return adib_company, master_company

def copy_table_data(db: Session, model_class, adib_id: int, master_id: int, model_name: str):
    """Copy all records from one company to another for a given model"""
    try:
        # Get all records for Adib company
        source_records = db.query(model_class).filter(
            model_class.company_id == adib_id,
            model_class.is_deleted == False
        ).all()
        
        if not source_records:
            print(f"   ⚠️  No {model_name} found for Adib company")
            return 0
        
        copied_count = 0
        skipped_count = 0
        
        for record in source_records:
            # Check if record already exists for Master (by some unique identifier)
            # For most models, we'll just copy and update company_id
            existing = None
            
            # Try to find existing record by name/code if available
            if hasattr(record, 'name'):
                existing = db.query(model_class).filter(
                    model_class.company_id == master_id,
                    model_class.name == record.name,
                    model_class.is_deleted == False
                ).first()
            elif hasattr(record, 'code'):
                existing = db.query(model_class).filter(
                    model_class.company_id == master_id,
                    model_class.code == record.code,
                    model_class.is_deleted == False
                ).first()
            elif hasattr(record, 'customer_number'):
                existing = db.query(model_class).filter(
                    model_class.company_id == master_id,
                    model_class.customer_number == record.customer_number,
                    model_class.is_deleted == False
                ).first()
            
            if existing:
                skipped_count += 1
                continue
            
            # Create a copy of the record
            record_dict = {}
            for column in model_class.__table__.columns:
                col_name = column.name
                if col_name == 'id':
                    continue  # Skip ID - will be auto-generated
                elif col_name == 'company_id':
                    record_dict[col_name] = master_id  # Set to Master company
                elif col_name in ['created_at', 'updated_at']:
                    continue  # Will be set automatically
                else:
                    value = getattr(record, col_name)
                    record_dict[col_name] = value
            
            # Create new record
            new_record = model_class(**record_dict)
            db.add(new_record)
            copied_count += 1
        
        db.flush()
        print(f"   ✅ {model_name}: Copied {copied_count}, Skipped {skipped_count} (already exists)")
        return copied_count
        
    except Exception as e:
        print(f"   ❌ Error copying {model_name}: {str(e)}")
        import traceback
        traceback.print_exc()
        return 0

def copy_related_data(db: Session, adib_id: int, master_id: int):
    """Copy data that has relationships (stations, tanks, islands, dispensers, nozzles, meters)"""
    print("\n📦 Copying related infrastructure data with relationships...")
    
    # Step 1: Create station mapping (adib_station_id -> master_station_id)
    adib_stations = db.query(Station).filter(
        Station.company_id == adib_id,
        Station.is_deleted == False
    ).all()
    
    master_stations = db.query(Station).filter(
        Station.company_id == master_id,
        Station.is_deleted == False
    ).all()
    
    station_map = {}
    for adib_station in adib_stations:
        # Find corresponding master station by name
        master_station = next((s for s in master_stations if s.name == adib_station.name), None)
        if master_station:
            station_map[adib_station.id] = master_station.id
        else:
            print(f"   ⚠️  Master station '{adib_station.name}' not found - skipping related data")
    
    # Step 2: Copy islands with station mapping
    print("   Copying Islands...")
    adib_islands = db.query(Island).filter(
        Island.company_id == adib_id,
        Island.is_deleted == False
    ).all()
    
    island_map = {}
    for island in adib_islands:
        master_station_id = station_map.get(island.station_id)
        if not master_station_id:
            continue
        
        existing = db.query(Island).filter(
            Island.company_id == master_id,
            Island.station_id == master_station_id,
            Island.island_number == island.island_number,
            Island.is_deleted == False
        ).first()
        
        if not existing:
            new_island = Island(
                company_id=master_id,
                station_id=master_station_id,
                island_number=island.island_number,
                island_name=island.island_name,
                location_description=island.location_description,
                notes=island.notes
            )
            db.add(new_island)
            db.flush()
            island_map[island.id] = new_island.id
        else:
            island_map[island.id] = existing.id
    
    # Step 3: Copy tanks with station and product mapping
    print("   Copying Tanks...")
    adib_tanks = db.query(Tank).filter(
        Tank.company_id == adib_id,
        Tank.is_deleted == False
    ).all()
    
    # Get item/product mapping (for tank.product_id)
    adib_items = db.query(Item).filter(
        Item.company_id == adib_id,
        Item.is_deleted == False
    ).all()
    
    master_items = db.query(Item).filter(
        Item.company_id == master_id,
        Item.is_deleted == False
    ).all()
    
    item_map = {}
    for adib_item in adib_items:
        master_item = next((i for i in master_items if i.name == adib_item.name), None)
        if master_item:
            item_map[adib_item.id] = master_item.id
    
    tank_map = {}
    for tank in adib_tanks:
        master_station_id = station_map.get(tank.station_id) if tank.station_id else None
        master_product_id = item_map.get(tank.product_id) if tank.product_id else None
        
        if not master_station_id or not master_product_id:
            print(f"      ⚠️  Skipping tank {tank.name} - missing station or product mapping")
            continue
        
        existing = db.query(Tank).filter(
            Tank.company_id == master_id,
            Tank.station_id == master_station_id,
            Tank.name == tank.name,
            Tank.is_deleted == False
        ).first()
        
        if not existing:
            # Get all tank attributes
            tank_dict = {}
            for column in Tank.__table__.columns:
                col_name = column.name
                if col_name == 'id':
                    continue
                elif col_name == 'company_id':
                    tank_dict[col_name] = master_id
                elif col_name == 'station_id':
                    tank_dict[col_name] = master_station_id
                elif col_name == 'product_id':
                    tank_dict[col_name] = master_product_id
                else:
                    value = getattr(tank, col_name, None)
                    if value is not None:
                        tank_dict[col_name] = value
            
            new_tank = Tank(**tank_dict)
            db.add(new_tank)
            db.flush()
            tank_map[tank.id] = new_tank.id
        else:
            tank_map[tank.id] = existing.id
    
    # Step 4: Copy dispensers with island mapping
    print("   Copying Dispensers...")
    adib_dispensers = db.query(Dispenser).filter(
        Dispenser.company_id == adib_id,
        Dispenser.is_deleted == False
    ).all()
    
    dispenser_map = {}
    for dispenser in adib_dispensers:
        master_island_id = island_map.get(dispenser.island_id) if dispenser.island_id else None
        if dispenser.island_id and not master_island_id:
            continue
        
        existing = db.query(Dispenser).filter(
            Dispenser.company_id == master_id,
            Dispenser.island_id == master_island_id,
            Dispenser.dispenser_number == dispenser.dispenser_number,
            Dispenser.is_deleted == False
        ).first()
        
        if not existing:
            new_dispenser = Dispenser(
                company_id=master_id,
                island_id=master_island_id,
                dispenser_number=dispenser.dispenser_number,
                dispenser_name=dispenser.dispenser_name,
                manufacturer=dispenser.manufacturer,
                model=dispenser.model,
                serial_number=dispenser.serial_number,
                notes=dispenser.notes
            )
            db.add(new_dispenser)
            db.flush()
            dispenser_map[dispenser.id] = new_dispenser.id
        else:
            dispenser_map[dispenser.id] = existing.id
    
    # Step 5: Copy meters with dispenser mapping
    print("   Copying Meters...")
    adib_meters = db.query(Meter).filter(
        Meter.company_id == adib_id,
        Meter.is_deleted == False
    ).all()
    
    meter_map = {}
    for meter in adib_meters:
        master_dispenser_id = dispenser_map.get(meter.dispenser_id) if hasattr(meter, 'dispenser_id') and meter.dispenser_id else None
        
        existing = db.query(Meter).filter(
            Meter.company_id == master_id,
            Meter.meter_number == meter.meter_number,
            Meter.is_deleted == False
        ).first()
        
        if not existing:
            # Get all meter attributes
            meter_dict = {}
            for column in Meter.__table__.columns:
                col_name = column.name
                if col_name == 'id':
                    continue
                elif col_name == 'company_id':
                    meter_dict[col_name] = master_id
                elif col_name == 'dispenser_id' and master_dispenser_id:
                    meter_dict[col_name] = master_dispenser_id
                else:
                    value = getattr(meter, col_name, None)
                    if value is not None:
                        meter_dict[col_name] = value
            
            new_meter = Meter(**meter_dict)
            db.add(new_meter)
            db.flush()
            meter_map[meter.id] = new_meter.id
        else:
            meter_map[meter.id] = existing.id
    
    # Step 6: Copy nozzles with meter and tank mapping
    print("   Copying Nozzles...")
    adib_nozzles = db.query(Nozzle).filter(
        Nozzle.company_id == adib_id,
        Nozzle.is_deleted == False
    ).all()
    
    nozzle_count = 0
    for nozzle in adib_nozzles:
        master_meter_id = meter_map.get(nozzle.meter_id) if nozzle.meter_id else None
        master_tank_id = tank_map.get(nozzle.tank_id) if nozzle.tank_id else None
        
        # Nozzles require both meter_id and tank_id
        if not master_meter_id or not master_tank_id:
            print(f"      ⚠️  Skipping nozzle {nozzle.nozzle_number} - missing meter or tank mapping")
            continue
        
        existing = db.query(Nozzle).filter(
            Nozzle.company_id == master_id,
            Nozzle.nozzle_number == nozzle.nozzle_number,
            Nozzle.is_deleted == False
        ).first()
        
        if not existing:
            # Get all nozzle attributes
            nozzle_dict = {}
            for column in Nozzle.__table__.columns:
                col_name = column.name
                if col_name == 'id':
                    continue
                elif col_name == 'company_id':
                    nozzle_dict[col_name] = master_id
                elif col_name == 'meter_id':
                    nozzle_dict[col_name] = master_meter_id
                elif col_name == 'tank_id':
                    nozzle_dict[col_name] = master_tank_id
                else:
                    value = getattr(nozzle, col_name, None)
                    if value is not None:
                        nozzle_dict[col_name] = value
            
            new_nozzle = Nozzle(**nozzle_dict)
            db.add(new_nozzle)
            db.flush()
            nozzle_count += 1
    
    print(f"      ✅ Copied {nozzle_count} nozzles")
    
    db.flush()
    print("   ✅ Infrastructure relationships copied")

def copy_transactions(db: Session, adib_id: int, master_id: int, days: int = 90):
    """Copy financial transactions (invoices, bills, payments, journal entries)"""
    from datetime import datetime, timedelta
    from app.models.invoice import Invoice, InvoiceLineItem
    from app.models.bill import Bill, BillLineItem
    from app.models.payment import Payment
    from app.models.journal_entry import JournalEntry, JournalEntryLine
    
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
    print(f"\n💰 Copying transactions (last {days} days)...")
    
    # Get customer and vendor mappings
    adib_customers = db.query(Customer).filter(
        Customer.company_id == adib_id,
        Customer.is_deleted == False
    ).all()
    master_customers = db.query(Customer).filter(
        Customer.company_id == master_id,
        Customer.is_deleted == False
    ).all()
    customer_map = {}
    for adib_cust in adib_customers:
        master_cust = next((c for c in master_customers if c.customer_number == adib_cust.customer_number), None)
        if master_cust:
            customer_map[adib_cust.id] = master_cust.id
    
    adib_vendors = db.query(Vendor).filter(
        Vendor.company_id == adib_id,
        Vendor.is_deleted == False
    ).all()
    master_vendors = db.query(Vendor).filter(
        Vendor.company_id == master_id,
        Vendor.is_deleted == False
    ).all()
    vendor_map = {}
    for adib_vend in adib_vendors:
        master_vend = next((v for v in master_vendors if v.vendor_number == adib_vend.vendor_number), None)
        if master_vend:
            vendor_map[adib_vend.id] = master_vend.id
    
    # Copy Invoices with Line Items
    print("   Copying Invoices...")
    adib_invoices = db.query(Invoice).filter(
        Invoice.company_id == adib_id,
        Invoice.is_deleted == False,
        Invoice.invoice_date >= cutoff_date.date()
    ).all()
    
    invoice_count = 0
    for invoice in adib_invoices:
        master_customer_id = customer_map.get(invoice.customer_id)
        if not master_customer_id:
            continue
        
        # Check if invoice already exists
        existing = db.query(Invoice).filter(
            Invoice.company_id == master_id,
            Invoice.invoice_number == invoice.invoice_number,
            Invoice.is_deleted == False
        ).first()
        
        if existing:
            continue
        
        # Create invoice
        invoice_dict = {}
        for column in Invoice.__table__.columns:
            col_name = column.name
            if col_name == 'id':
                continue
            elif col_name == 'company_id':
                invoice_dict[col_name] = master_id
            elif col_name == 'customer_id':
                invoice_dict[col_name] = master_customer_id
            else:
                value = getattr(invoice, col_name, None)
                if value is not None:
                    invoice_dict[col_name] = value
        
        new_invoice = Invoice(**invoice_dict)
        db.add(new_invoice)
        db.flush()
        
        # Copy line items
        line_items = db.query(InvoiceLineItem).filter(
            InvoiceLineItem.invoice_id == invoice.id,
            InvoiceLineItem.is_deleted == False
        ).all()
        
        for line_item in line_items:
            line_item_dict = {}
            for column in InvoiceLineItem.__table__.columns:
                col_name = column.name
                if col_name == 'id':
                    continue
                elif col_name == 'invoice_id':
                    line_item_dict[col_name] = new_invoice.id
                elif col_name == 'company_id':
                    line_item_dict[col_name] = master_id
                else:
                    value = getattr(line_item, col_name, None)
                    if value is not None:
                        line_item_dict[col_name] = value
            
            new_line_item = InvoiceLineItem(**line_item_dict)
            db.add(new_line_item)
        
        invoice_count += 1
    
    print(f"      ✅ Copied {invoice_count} invoices with line items")
    
    # Copy Bills with Line Items
    print("   Copying Bills...")
    adib_bills = db.query(Bill).filter(
        Bill.company_id == adib_id,
        Bill.is_deleted == False,
        Bill.bill_date >= cutoff_date.date()
    ).all()
    
    bill_count = 0
    for bill in adib_bills:
        master_vendor_id = vendor_map.get(bill.vendor_id)
        if not master_vendor_id:
            continue
        
        existing = db.query(Bill).filter(
            Bill.company_id == master_id,
            Bill.bill_number == bill.bill_number,
            Bill.is_deleted == False
        ).first()
        
        if existing:
            continue
        
        bill_dict = {}
        for column in Bill.__table__.columns:
            col_name = column.name
            if col_name == 'id':
                continue
            elif col_name == 'company_id':
                bill_dict[col_name] = master_id
            elif col_name == 'vendor_id':
                bill_dict[col_name] = master_vendor_id
            else:
                value = getattr(bill, col_name, None)
                if value is not None:
                    bill_dict[col_name] = value
        
        new_bill = Bill(**bill_dict)
        db.add(new_bill)
        db.flush()
        
        # Copy line items
        line_items = db.query(BillLineItem).filter(
            BillLineItem.bill_id == bill.id,
            BillLineItem.is_deleted == False
        ).all()
        
        for line_item in line_items:
            line_item_dict = {}
            for column in BillLineItem.__table__.columns:
                col_name = column.name
                if col_name == 'id':
                    continue
                elif col_name == 'bill_id':
                    line_item_dict[col_name] = new_bill.id
                elif col_name == 'company_id':
                    line_item_dict[col_name] = master_id
                else:
                    value = getattr(line_item, col_name, None)
                    if value is not None:
                        line_item_dict[col_name] = value
            
            new_line_item = BillLineItem(**line_item_dict)
            db.add(new_line_item)
        
        bill_count += 1
    
    print(f"      ✅ Copied {bill_count} bills with line items")
    
    # Copy Payments
    print("   Copying Payments...")
    adib_payments = db.query(Payment).filter(
        Payment.company_id == adib_id,
        Payment.is_deleted == False,
        Payment.payment_date >= cutoff_date.date()
    ).all()
    
    payment_count = 0
    for payment in adib_payments:
        existing = db.query(Payment).filter(
            Payment.company_id == master_id,
            Payment.payment_number == payment.payment_number,
            Payment.is_deleted == False
        ).first()
        
        if existing:
            continue
        
        payment_dict = {}
        for column in Payment.__table__.columns:
            col_name = column.name
            if col_name == 'id':
                continue
            elif col_name == 'company_id':
                payment_dict[col_name] = master_id
            else:
                value = getattr(payment, col_name, None)
                if value is not None:
                    payment_dict[col_name] = value
        
        new_payment = Payment(**payment_dict)
        db.add(new_payment)
        payment_count += 1
    
    print(f"      ✅ Copied {payment_count} payments")
    
    # Copy Journal Entries
    print("   Copying Journal Entries...")
    adib_journal_entries = db.query(JournalEntry).filter(
        JournalEntry.company_id == adib_id,
        JournalEntry.is_deleted == False,
        JournalEntry.entry_date >= cutoff_date.date()
    ).all()
    
    journal_count = 0
    for entry in adib_journal_entries:
        existing = db.query(JournalEntry).filter(
            JournalEntry.company_id == master_id,
            JournalEntry.entry_number == entry.entry_number,
            JournalEntry.is_deleted == False
        ).first()
        
        if existing:
            continue
        
        entry_dict = {}
        for column in JournalEntry.__table__.columns:
            col_name = column.name
            if col_name == 'id':
                continue
            elif col_name == 'company_id':
                entry_dict[col_name] = master_id
            else:
                value = getattr(entry, col_name, None)
                if value is not None:
                    entry_dict[col_name] = value
        
        new_entry = JournalEntry(**entry_dict)
        db.add(new_entry)
        db.flush()
        
        # Copy line items
        line_items = db.query(JournalEntryLine).filter(
            JournalEntryLine.journal_entry_id == entry.id,
            JournalEntryLine.is_deleted == False
        ).all()
        
        for line_item in line_items:
            line_item_dict = {}
            for column in JournalEntryLine.__table__.columns:
                col_name = column.name
                if col_name == 'id':
                    continue
                elif col_name == 'journal_entry_id':
                    line_item_dict[col_name] = new_entry.id
                elif col_name == 'company_id':
                    line_item_dict[col_name] = master_id
                else:
                    value = getattr(line_item, col_name, None)
                    if value is not None:
                        line_item_dict[col_name] = value
            
            new_line_item = JournalEntryLine(**line_item_dict)
            db.add(new_line_item)
        
        journal_count += 1
    
    print(f"      ✅ Copied {journal_count} journal entries with line items")
    
    db.flush()
    return invoice_count + bill_count + payment_count + journal_count

def main():
    """Main function to copy all data"""
    print("="*70)
    print("Copying Data from Adib Filling Station to Master Company")
    print("="*70)
    
    db: Session = SessionLocal()
    try:
        # Get companies
        adib_company, master_company = get_companies(db)
        if not adib_company or not master_company:
            return
        
        if adib_company.id == master_company.id:
            print("❌ ERROR: Adib and Master are the same company!")
            return
        
        print(f"\n🔄 Starting data copy process...")
        print(f"   From: {adib_company.name} (ID: {adib_company.id})")
        print(f"   To: {master_company.name} (ID: {master_company.id})")
        
        total_copied = 0
        
        # Copy basic data (no complex relationships)
        print("\n📋 Copying basic data...")
        models_to_copy = [
            (ChartOfAccount, "Chart of Accounts"),
            (BankAccount, "Bank Accounts"),
            (Item, "Items/Products"),
            (Customer, "Customers"),
            (Vendor, "Vendors"),
            (Employee, "Employees"),
        ]
        
        for model_class, model_name in models_to_copy:
            count = copy_table_data(db, model_class, adib_company.id, master_company.id, model_name)
            total_copied += count
        
        # Copy infrastructure data (stations first, then related data)
        print("\n🏗️  Copying infrastructure data...")
        count = copy_table_data(db, Station, adib_company.id, master_company.id, "Stations")
        total_copied += count
        
        # Copy related infrastructure data (islands, tanks, dispensers, nozzles, meters)
        # This must be done after stations are copied to maintain relationships
        copy_related_data(db, adib_company.id, master_company.id)
        
        # Copy tax codes
        print("\n📋 Copying tax data...")
        count = copy_table_data(db, TaxCode, adib_company.id, master_company.id, "Tax Codes")
        total_copied += count
        
        # Copy transactions (invoices, bills, payments, journal entries)
        # Ask user for number of days (default: 90 days)
        import sys
        days = 90
        if len(sys.argv) > 1:
            try:
                days = int(sys.argv[1])
            except ValueError:
                print(f"⚠️  Invalid days argument, using default: 90 days")
        
        transaction_count = copy_transactions(db, adib_company.id, master_company.id, days)
        total_copied += transaction_count
        
        # Commit all changes
        db.commit()
        
        # Log audit event
        try:
            from app.utils.audit_logger import log_data_copy
            # Get super admin user for logging
            from app.models.user import User, UserRole
            super_admin = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
            if super_admin:
                log_data_copy(
                    db=db,
                    user_id=super_admin.id,
                    user_email=super_admin.email,
                    source_company_id=adib_company.id,
                    target_company_id=master_company.id,
                    copy_type="full_copy",
                    record_count=total_copied,
                    details={"days": days, "transaction_count": transaction_count}
                )
                db.commit()
        except Exception as audit_error:
            print(f"⚠️  Warning: Failed to log audit event: {audit_error}")
            db.rollback()
        
        print("\n" + "="*70)
        print(f"✅ Data copy completed!")
        print(f"   Total records copied: {total_copied}")
        print("="*70)
        
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    main()

