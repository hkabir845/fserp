"""
Seed script for Platform Settings
Creates default settings, currencies, and units of measure
"""
import sys
import os

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from datetime import datetime
from decimal import Decimal
from app.db.session import SessionLocal
from app.modules.platform.models import PlatformSettings, Currency, UnitOfMeasure

def seed_platform_settings():
    """Seed platform settings, currencies, and UOMs"""
    db = SessionLocal()
    try:
        print("\n" + "="*60)
        print("Seeding Platform Settings, Currencies, and UOMs")
        print("="*60 + "\n")
        
        # ========== Create Platform Settings ==========
        print("Creating Platform Settings...")
        settings_data = [
            # General Settings
            {"key": "company_name", "value": "FMERP Platform", "category": "general", "description": "Platform company name"},
            {"key": "company_address", "value": "", "category": "general", "description": "Company address"},
            {"key": "company_phone", "value": "", "category": "general", "description": "Company phone number"},
            {"key": "company_email", "value": "support@fmerp.com", "category": "general", "description": "Company support email"},
            {"key": "company_website", "value": "https://fmerp.com", "category": "general", "description": "Company website"},
            
            # System Settings
            {"key": "default_language", "value": "en", "category": "system", "description": "Default system language"},
            {"key": "locale", "value": "en-BD", "category": "system", "description": "BCP 47 locale for SaaS UI and formatting"},
            {"key": "default_timezone", "value": "Asia/Dhaka", "category": "system", "description": "Default timezone"},
            {"key": "date_format", "value": "DD/MM/YYYY", "category": "system", "description": "Default date format"},
            {"key": "time_format", "value": "24h", "category": "system", "description": "Default time format (12h or 24h)"},
            {"key": "first_day_of_week", "value": "monday", "category": "system", "description": "Calendar week start (monday or sunday)"},
            {"key": "number_grouping", "value": "standard", "category": "system", "description": "Number grouping style (standard, indian)"},
            
            # Feed Manufacturing Settings
            {"key": "default_batch_size", "value": "1000", "category": "feed_manufacturing", "description": "Default production batch size (kg)"},
            {"key": "default_loss_factor", "value": "2.0", "category": "feed_manufacturing", "description": "Default loss factor percentage"},
            {"key": "enable_premix_conversion", "value": "true", "category": "feed_manufacturing", "description": "Enable premix conversion"},
            {"key": "exclude_water_steam", "value": "true", "category": "feed_manufacturing", "description": "Exclude water and steam from BOM totals"},
            
            # Billing Settings
            {"key": "trial_period_days", "value": "14", "category": "billing", "description": "Default trial period in days"},
            {"key": "invoice_prefix", "value": "INV", "category": "billing", "description": "Invoice number prefix"},
            {"key": "tax_rate", "value": "0.0", "category": "billing", "description": "Default tax rate percentage"},
        ]
        
        for setting_data in settings_data:
            setting = db.query(PlatformSettings).filter(
                PlatformSettings.key == setting_data["key"]
            ).first()
            if not setting:
                setting = PlatformSettings(
                    key=setting_data["key"],
                    value=setting_data["value"],
                    value_type="string",
                    category=setting_data["category"],
                    description=setting_data.get("description"),
                    is_public=False
                )
                db.add(setting)
                print(f"  [OK] Created setting: {setting_data['key']}")
            else:
                print(f"  [SKIP] Setting already exists: {setting_data['key']}")
        
        db.flush()
        
        # ========== Create Currencies ==========
        print("\nCreating Currencies...")
        currencies_data = [
            {"code": "BDT", "name": "Bangladesh Taka", "symbol": "৳", "decimal_places": 2, "is_default": True, "exchange_rate": 1.0},
            {"code": "USD", "name": "US Dollar", "symbol": "$", "decimal_places": 2, "is_default": False, "exchange_rate": 110.0},
            {"code": "EUR", "name": "Euro", "symbol": "€", "decimal_places": 2, "is_default": False, "exchange_rate": 120.0},
            {"code": "GBP", "name": "British Pound", "symbol": "£", "decimal_places": 2, "is_default": False, "exchange_rate": 140.0},
            {"code": "INR", "name": "Indian Rupee", "symbol": "₹", "decimal_places": 2, "is_default": False, "exchange_rate": 1.3},
        ]
        
        # Ensure only one default currency
        default_exists = db.query(Currency).filter(Currency.is_default == True).first()
        
        for currency_data in currencies_data:
            currency = db.query(Currency).filter(Currency.code == currency_data["code"]).first()
            if not currency:
                # If this is default and another default exists, don't set it
                if currency_data["is_default"] and default_exists:
                    currency_data["is_default"] = False
                
                currency = Currency(
                    code=currency_data["code"],
                    name=currency_data["name"],
                    symbol=currency_data["symbol"],
                    decimal_places=currency_data["decimal_places"],
                    is_default=currency_data["is_default"],
                    exchange_rate=Decimal(str(currency_data["exchange_rate"])),
                    is_active=True
                )
                db.add(currency)
                if currency_data["is_default"]:
                    default_exists = currency
                print(f"  [OK] Created currency: {currency_data['code']} - {currency_data['name']}")
            else:
                print(f"  [SKIP] Currency already exists: {currency_data['code']}")
        
        db.flush()
        
        # ========== Create Units of Measure ==========
        print("\nCreating Units of Measure...")
        uoms_data = [
            # ========== WEIGHT UNITS (Base: KG) ==========
            {"code": "KG", "name": "Kilogram", "category": "weight", "base_unit": "KG", "conversion_factor": 1.0},
            {"code": "G", "name": "Gram", "category": "weight", "base_unit": "KG", "conversion_factor": 0.001},
            {"code": "MG", "name": "Milligram", "category": "weight", "base_unit": "KG", "conversion_factor": 0.000001},
            {"code": "MT", "name": "Metric Ton", "category": "weight", "base_unit": "KG", "conversion_factor": 1000.0},
            {"code": "TON", "name": "Ton", "category": "weight", "base_unit": "KG", "conversion_factor": 1000.0},
            {"code": "QUINTAL", "name": "Quintal", "category": "weight", "base_unit": "KG", "conversion_factor": 100.0},  # 100 kg
            {"code": "MAUND", "name": "Maund", "category": "weight", "base_unit": "KG", "conversion_factor": 37.3242},  # Regional unit (Bangladesh/India)
            {"code": "LB", "name": "Pound", "category": "weight", "base_unit": "KG", "conversion_factor": 0.453592},
            {"code": "OZ", "name": "Ounce", "category": "weight", "base_unit": "KG", "conversion_factor": 0.0283495},
            {"code": "STONE", "name": "Stone", "category": "weight", "base_unit": "KG", "conversion_factor": 6.35029},
            
            # ========== VOLUME UNITS (Base: L) ==========
            {"code": "L", "name": "Liter", "category": "volume", "base_unit": "L", "conversion_factor": 1.0},
            {"code": "ML", "name": "Milliliter", "category": "volume", "base_unit": "L", "conversion_factor": 0.001},
            {"code": "KL", "name": "Kiloliter", "category": "volume", "base_unit": "L", "conversion_factor": 1000.0},
            {"code": "GAL", "name": "Gallon (US)", "category": "volume", "base_unit": "L", "conversion_factor": 3.78541},
            {"code": "GAL_UK", "name": "Gallon (UK)", "category": "volume", "base_unit": "L", "conversion_factor": 4.54609},
            {"code": "FL_OZ", "name": "Fluid Ounce", "category": "volume", "base_unit": "L", "conversion_factor": 0.0295735},
            {"code": "CUBIC_M", "name": "Cubic Meter", "category": "volume", "base_unit": "L", "conversion_factor": 1000.0},
            {"code": "CUBIC_CM", "name": "Cubic Centimeter", "category": "volume", "base_unit": "L", "conversion_factor": 0.001},
            {"code": "BARREL", "name": "Barrel", "category": "volume", "base_unit": "L", "conversion_factor": 158.987},
            
            # ========== LENGTH UNITS (Base: M) ==========
            {"code": "M", "name": "Meter", "category": "length", "base_unit": "M", "conversion_factor": 1.0},
            {"code": "CM", "name": "Centimeter", "category": "length", "base_unit": "M", "conversion_factor": 0.01},
            {"code": "MM", "name": "Millimeter", "category": "length", "base_unit": "M", "conversion_factor": 0.001},
            {"code": "KM", "name": "Kilometer", "category": "length", "base_unit": "M", "conversion_factor": 1000.0},
            {"code": "FT", "name": "Feet", "category": "length", "base_unit": "M", "conversion_factor": 0.3048},
            {"code": "IN", "name": "Inch", "category": "length", "base_unit": "M", "conversion_factor": 0.0254},
            {"code": "YD", "name": "Yard", "category": "length", "base_unit": "M", "conversion_factor": 0.9144},
            {"code": "MI", "name": "Mile", "category": "length", "base_unit": "M", "conversion_factor": 1609.34},
            {"code": "NM", "name": "Nautical Mile", "category": "length", "base_unit": "M", "conversion_factor": 1852.0},
            
            # ========== AREA UNITS (Base: SQ_M) ==========
            {"code": "SQ_M", "name": "Square Meter", "category": "area", "base_unit": "SQ_M", "conversion_factor": 1.0},
            {"code": "SQ_CM", "name": "Square Centimeter", "category": "area", "base_unit": "SQ_M", "conversion_factor": 0.0001},
            {"code": "SQ_KM", "name": "Square Kilometer", "category": "area", "base_unit": "SQ_M", "conversion_factor": 1000000.0},
            {"code": "HECTARE", "name": "Hectare", "category": "area", "base_unit": "SQ_M", "conversion_factor": 10000.0},
            {"code": "ACRE", "name": "Acre", "category": "area", "base_unit": "SQ_M", "conversion_factor": 4046.86},
            {"code": "SQ_FT", "name": "Square Feet", "category": "area", "base_unit": "SQ_M", "conversion_factor": 0.092903},
            {"code": "SQ_IN", "name": "Square Inch", "category": "area", "base_unit": "SQ_M", "conversion_factor": 0.00064516},
            {"code": "SQ_YD", "name": "Square Yard", "category": "area", "base_unit": "SQ_M", "conversion_factor": 0.836127},
            
            # ========== COUNT / PIECE UNITS ==========
            {"code": "NOS", "name": "Numbers", "category": "count", "base_unit": None, "conversion_factor": 1.0},
            {"code": "PCS", "name": "Pieces", "category": "count", "base_unit": None, "conversion_factor": 1.0},
            {"code": "PIECE", "name": "Piece", "category": "count", "base_unit": None, "conversion_factor": 1.0},
            {"code": "UNIT", "name": "Unit", "category": "count", "base_unit": None, "conversion_factor": 1.0},
            {"code": "EA", "name": "Each", "category": "count", "base_unit": None, "conversion_factor": 1.0},
            {"code": "DOZ", "name": "Dozen", "category": "count", "base_unit": None, "conversion_factor": 12.0},
            {"code": "GROSS", "name": "Gross", "category": "count", "base_unit": None, "conversion_factor": 144.0},
            {"code": "REAM", "name": "Ream", "category": "count", "base_unit": None, "conversion_factor": 500.0},  # For paper/packaging
            
            # ========== PACKAGING UNITS ==========
            {"code": "BAG", "name": "Bag", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "PKT", "name": "Packet", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "BOX", "name": "Box", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "CARTON", "name": "Carton", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "DRUM", "name": "Drum", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "BOTTLE", "name": "Bottle", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "CAN", "name": "Can", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "JAR", "name": "Jar", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "TUBE", "name": "Tube", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "PALLET", "name": "Pallet", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            {"code": "CONTAINER", "name": "Container", "category": "packaging", "base_unit": None, "conversion_factor": 1.0},
            
            # ========== TIME UNITS ==========
            {"code": "SEC", "name": "Second", "category": "time", "base_unit": "MIN", "conversion_factor": 0.0166667},
            {"code": "MIN", "name": "Minute", "category": "time", "base_unit": "MIN", "conversion_factor": 1.0},
            {"code": "HR", "name": "Hour", "category": "time", "base_unit": "MIN", "conversion_factor": 60.0},
            {"code": "DAY", "name": "Day", "category": "time", "base_unit": "MIN", "conversion_factor": 1440.0},
            {"code": "WEEK", "name": "Week", "category": "time", "base_unit": "MIN", "conversion_factor": 10080.0},
            {"code": "MONTH", "name": "Month", "category": "time", "base_unit": "MIN", "conversion_factor": 43200.0},  # 30 days
            {"code": "YEAR", "name": "Year", "category": "time", "base_unit": "MIN", "conversion_factor": 525600.0},  # 365 days
            
            # ========== TEMPERATURE UNITS ==========
            {"code": "CEL", "name": "Celsius", "category": "temperature", "base_unit": None, "conversion_factor": 1.0},
            {"code": "FAR", "name": "Fahrenheit", "category": "temperature", "base_unit": None, "conversion_factor": 1.0},
            {"code": "KEL", "name": "Kelvin", "category": "temperature", "base_unit": None, "conversion_factor": 1.0},
            
            # ========== PERCENTAGE / RATIO UNITS ==========
            {"code": "PCT", "name": "Percent", "category": "percentage", "base_unit": None, "conversion_factor": 1.0},
            {"code": "PPM", "name": "Parts Per Million", "category": "percentage", "base_unit": None, "conversion_factor": 0.0001},  # 1 ppm = 0.0001%
            {"code": "PPB", "name": "Parts Per Billion", "category": "percentage", "base_unit": None, "conversion_factor": 0.0000001},  # 1 ppb = 0.0000001%
            
            # ========== ENERGY / NUTRITION UNITS ==========
            {"code": "KCAL", "name": "Kilocalorie", "category": "energy", "base_unit": "KCAL", "conversion_factor": 1.0},
            {"code": "CAL", "name": "Calorie", "category": "energy", "base_unit": "KCAL", "conversion_factor": 0.001},
            {"code": "KJ", "name": "Kilojoule", "category": "energy", "base_unit": "KCAL", "conversion_factor": 0.239006},  # 1 kJ = 0.239 kcal
            {"code": "MJ", "name": "Megajoule", "category": "energy", "base_unit": "KCAL", "conversion_factor": 239.006},
            
            # ========== RATE / PRODUCTION UNITS ==========
            {"code": "KG_PER_HR", "name": "Kilogram Per Hour", "category": "rate", "base_unit": None, "conversion_factor": 1.0},
            {"code": "TON_PER_HR", "name": "Ton Per Hour", "category": "rate", "base_unit": None, "conversion_factor": 1000.0},
            {"code": "L_PER_HR", "name": "Liter Per Hour", "category": "rate", "base_unit": None, "conversion_factor": 1.0},
            {"code": "KG_PER_MIN", "name": "Kilogram Per Minute", "category": "rate", "base_unit": None, "conversion_factor": 0.0166667},
            {"code": "MT_PER_DAY", "name": "Metric Ton Per Day", "category": "rate", "base_unit": None, "conversion_factor": 1.0},
            
            # ========== CONCENTRATION UNITS (for additives, premix) ==========
            {"code": "G_PER_KG", "name": "Gram Per Kilogram", "category": "concentration", "base_unit": None, "conversion_factor": 1.0},
            {"code": "G_PER_TON", "name": "Gram Per Ton", "category": "concentration", "base_unit": None, "conversion_factor": 0.001},  # 1 g/ton = 0.001 g/kg
            {"code": "KG_PER_TON", "name": "Kilogram Per Ton", "category": "concentration", "base_unit": None, "conversion_factor": 1.0},
            {"code": "ML_PER_L", "name": "Milliliter Per Liter", "category": "concentration", "base_unit": None, "conversion_factor": 1.0},
            {"code": "ML_PER_KG", "name": "Milliliter Per Kilogram", "category": "concentration", "base_unit": None, "conversion_factor": 1.0},
            
            # ========== PRESSURE UNITS (for manufacturing processes) ==========
            {"code": "BAR", "name": "Bar", "category": "pressure", "base_unit": None, "conversion_factor": 1.0},
            {"code": "PSI", "name": "Pound Per Square Inch", "category": "pressure", "base_unit": None, "conversion_factor": 0.0689476},  # 1 bar = 14.5 psi
            {"code": "PA", "name": "Pascal", "category": "pressure", "base_unit": None, "conversion_factor": 0.00001},  # 1 bar = 100,000 Pa
            {"code": "KPA", "name": "Kilopascal", "category": "pressure", "base_unit": None, "conversion_factor": 0.01},
            
            # ========== SPEED / VELOCITY UNITS ==========
            {"code": "M_PER_SEC", "name": "Meter Per Second", "category": "speed", "base_unit": None, "conversion_factor": 1.0},
            {"code": "KM_PER_HR", "name": "Kilometer Per Hour", "category": "speed", "base_unit": None, "conversion_factor": 0.277778},  # 1 km/h = 0.278 m/s
            {"code": "MPH", "name": "Miles Per Hour", "category": "speed", "base_unit": None, "conversion_factor": 0.44704},
            {"code": "RPM", "name": "Revolutions Per Minute", "category": "speed", "base_unit": None, "conversion_factor": 1.0},
            
            # ========== POWER UNITS ==========
            {"code": "KW", "name": "Kilowatt", "category": "power", "base_unit": "KW", "conversion_factor": 1.0},
            {"code": "W", "name": "Watt", "category": "power", "base_unit": "KW", "conversion_factor": 0.001},
            {"code": "HP", "name": "Horsepower", "category": "power", "base_unit": "KW", "conversion_factor": 0.7457},
            {"code": "MW", "name": "Megawatt", "category": "power", "base_unit": "KW", "conversion_factor": 1000.0},
        ]
        
        for uom_data in uoms_data:
            uom = db.query(UnitOfMeasure).filter(UnitOfMeasure.code == uom_data["code"]).first()
            if not uom:
                uom = UnitOfMeasure(
                    code=uom_data["code"],
                    name=uom_data["name"],
                    category=uom_data["category"],
                    base_unit=uom_data.get("base_unit"),
                    conversion_factor=Decimal(str(uom_data["conversion_factor"])),
                    is_active=True
                )
                db.add(uom)
                print(f"  [OK] Created UOM: {uom_data['code']} - {uom_data['name']} ({uom_data['category']})")
            else:
                print(f"  [SKIP] UOM already exists: {uom_data['code']}")
        
        db.commit()
        
        print("\n" + "="*60)
        print("[SUCCESS] Platform Settings Seeded Successfully!")
        print("="*60)
        print(f"\nCreated:")
        print(f"  - {len(settings_data)} Platform Settings")
        print(f"  - {len(currencies_data)} Currencies (BDT is default)")
        print(f"  - {len(uoms_data)} Units of Measure")
        print("\n" + "="*60 + "\n")
        
    except Exception as e:
        db.rollback()
        print(f"\n[ERROR] Error seeding platform settings: {e}")
        import traceback
        traceback.print_exc()
        raise
    finally:
        db.close()

if __name__ == "__main__":
    seed_platform_settings()

