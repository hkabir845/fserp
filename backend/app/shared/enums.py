from enum import Enum

class ItemInventoryKind(str, Enum):
    """How the item is treated vs quantity on hand (filters, GL, purchasing)."""
    INVENTORY = "inventory"
    NON_INVENTORY = "non_inventory"
    SERVICE = "service"
    OTHER = "other"


class ItemType(str, Enum):
    # raw_material / finished_good: generic inventory
    # feed / flour: feed mill & flour mill verticals; fuel: in-house filling station & lubricants
    RAW_MATERIAL = "raw_material"
    FINISHED_GOOD = "finished_good"
    FEED = "feed"
    FLOUR = "flour"
    ANIMAL = "animal"
    BIRD = "bird"
    SERVICE = "service"
    FUEL = "fuel"

class DocumentStatus(str, Enum):
    DRAFT = "draft"
    POSTED = "posted"
    CANCELLED = "cancelled"

class AccountType(str, Enum):
    ASSET = "asset"
    LIABILITY = "liability"
    EQUITY = "equity"
    INCOME = "income"
    EXPENSE = "expense"

class TripType(str, Enum):
    OWN_DELIVERY = "own_delivery"
    THIRD_PARTY = "third_party"

class FuelTxnType(str, Enum):
    PURCHASE = "purchase"
    ISSUE_INTERNAL = "issue_internal"
    SALE_EXTERNAL = "sale_external"
    ADJUSTMENT = "adjustment"

class AnimalEventType(str, Enum):
    PURCHASE = "purchase"
    BIRTH = "birth"
    TRANSFER = "transfer"
    SALE = "sale"
    MORTALITY = "mortality"
    HEALTH = "health"

class SpeciesCategory(str, Enum):
    ANIMAL = "animal"
    BIRD = "bird"

class HerdPurpose(str, Enum):
    BREEDING = "breeding"
    FATTENING = "fattening"
    LAYER = "layer"
    BROILER = "broiler"
    OTHER = "other"

class BatchStatus(str, Enum):
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

# Feed Manufacturing Enums
class FeedCategory(str, Enum):
    FISH = "Fish"
    POULTRY = "Poultry"
    CATTLE = "Cattle"
    GOAT = "Goat"
    SHEEP = "Sheep"
    PET = "Pet"
    OTHERS = "Others"

class FeedSubtype(str, Enum):
    FLOATING = "Floating"
    SINKING = "Sinking"
    SLOW_SINKING = "Slow-sinking"

class FeedStage(str, Enum):
    # Fish
    FRY = "fry"
    FINGERLING = "fingerling"
    GROWER = "grower"
    FINISHER = "finisher"
    BROOD = "brood"
    # Poultry
    STARTER = "starter"
    LAYING = "laying"
    # Cattle/Goat/Sheep
    CALF = "calf"
    HEIFER = "heifer"
    LACTATING = "lactating"
    DRY = "dry"

class ProcessType(str, Enum):
    EXTRUDED_FLOATING = "Extruded floating"
    PELLETED = "Pelleted"
    MASH = "Mash"
    CRUMBLE = "Crumble"

class IngredientType(str, Enum):
    MACRO = "macro"
    MICRO = "micro"
    ADDITIVE = "additive"
    MEDICINE = "medicine"
    BINDER = "binder"

class InclusionBasis(str, Enum):
    PERCENT = "percent"
    KG_PER_TON = "kg_per_ton"
    G_PER_TON = "g_per_ton"

class BomStatus(str, Enum):
    DRAFT = "draft"
    APPROVED = "approved"
    ARCHIVED = "archived"

class ProductionOrderStatus(str, Enum):
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"

