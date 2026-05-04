"""
Script to replace all item placeholder images with real product images
Uses Unsplash API (free) to fetch real product images based on item names

Run this from the backend directory: python replace_item_images.py

Note: This script requires the 'requests' library:
    pip install requests

For better results, you can get a free Unsplash API key at https://unsplash.com/developers
But it works without one too (with rate limits).
"""
import sys
from pathlib import Path
import os
import uuid
import requests
from PIL import Image
import io

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from app.database import SessionLocal
from app.models.item import Item
from app.api.upload import UPLOAD_DIR

# Unsplash API (free, no key required for basic usage)
# You can get a free API key at https://unsplash.com/developers for better rate limits
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY", None)  # Optional
UNSPLASH_API_URL = "https://api.unsplash.com/search/photos"

# Alternative: Pexels API (also free)
PEXELS_API_KEY = os.getenv("PEXELS_API_KEY", None)  # Optional
PEXELS_API_URL = "https://api.pexels.com/v1/search"


def get_search_query(item_name: str, category: str = None) -> str:
    """
    Generate a search query for the image API based on item name and category
    """
    # Clean up item name - remove common prefixes/suffixes
    name = item_name.lower()
    
    # Map common item names to better search terms
    search_mapping = {
        'diesel': 'diesel fuel',
        'petrol': 'gasoline fuel',
        'octane': 'gasoline',
        'cola': 'coca cola can',
        'pepsi': 'pepsi can',
        'water': 'bottled water',
        'chip': 'potato chips',
        'biscuit': 'biscuits cookies',
        'noodle': 'instant noodles',
        'cigarette': 'cigarettes pack',
        'soap': 'bar soap',
        'shampoo': 'shampoo bottle',
        'toothpaste': 'toothpaste tube',
        'pen': 'ballpoint pen',
        'notebook': 'notebook book',
        'battery': 'AA battery',
        'lighter': 'lighter',
        'energy drink': 'energy drink can'
    }
    
    # Check for exact matches first
    for key, search_term in search_mapping.items():
        if key in name:
            return search_term
    
    # Use category if available
    if category:
        return f"{item_name} {category}"
    
    # Use item name as-is
    return item_name


def fetch_image_from_unsplash(query: str) -> bytes:
    """
    Fetch image from Unsplash API
    """
    try:
        headers = {}
        if UNSPLASH_ACCESS_KEY:
            headers["Authorization"] = f"Client-ID {UNSPLASH_ACCESS_KEY}"
        
        params = {
            "query": query,
            "per_page": 1,
            "orientation": "squarish"  # Better for product images
        }
        
        response = requests.get(UNSPLASH_API_URL, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("results") and len(data["results"]) > 0:
                image_url = data["results"][0]["urls"]["regular"]  # or "small" for smaller size
                # Download the image
                img_response = requests.get(image_url, timeout=10)
                if img_response.status_code == 200:
                    return img_response.content
        elif response.status_code == 403:
            # Rate limit or no API key - try Unsplash Source (no auth required)
            print("  [INFO] Using Unsplash Source (no API key)...")
            return fetch_image_from_unsplash_source(query)
    except Exception as e:
        print(f"  [WARN] Unsplash API error: {str(e)}")
        # Fallback to Unsplash Source
        return fetch_image_from_unsplash_source(query)
    
    return None


def fetch_image_from_unsplash_source(query: str) -> bytes:
    """
    Fetch image from Unsplash Source (no API key required, but less control)
    Uses a deterministic approach based on query hash
    """
    try:
        # Use Unsplash Source API (simpler, no auth needed)
        # This uses a hash-based approach to get consistent images
        import hashlib
        
        # Create a hash from the query to get consistent images
        query_hash = hashlib.md5(query.encode()).hexdigest()
        # Use the hash to get a deterministic image ID (0-1000)
        image_id = int(query_hash[:3], 16) % 1000
        
        # Unsplash Source URL (no auth required, but limited)
        source_url = f"https://source.unsplash.com/800x800/?{query.replace(' ', ',')}"
        
        # Download the image
        img_response = requests.get(source_url, timeout=15, allow_redirects=True)
        if img_response.status_code == 200 and img_response.headers.get('content-type', '').startswith('image/'):
            return img_response.content
    except Exception as e:
        print(f"  [WARN] Unsplash Source error: {str(e)}")
    
    return None


def fetch_image_from_pexels(query: str) -> bytes:
    """
    Fetch image from Pexels API (alternative to Unsplash)
    """
    try:
        headers = {}
        if PEXELS_API_KEY:
            headers["Authorization"] = PEXELS_API_KEY
        
        params = {
            "query": query,
            "per_page": 1,
            "orientation": "square"
        }
        
        response = requests.get(PEXELS_API_URL, params=params, headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("photos") and len(data["photos"]) > 0:
                image_url = data["photos"][0]["src"]["medium"]  # or "large" for higher quality
                # Download the image
                img_response = requests.get(image_url, timeout=10)
                if img_response.status_code == 200:
                    return img_response.content
    except Exception as e:
        print(f"  [WARN] Pexels API error: {str(e)}")
    
    return None


def process_and_save_image(image_data: bytes, max_size: tuple = (800, 800)) -> str:
    """
    Process and save image, returning the filename
    """
    try:
        # Open image
        image = Image.open(io.BytesIO(image_data))
        
        # Convert to RGB if necessary
        if image.mode in ("RGBA", "LA", "P"):
            rgb_image = Image.new("RGB", image.size, (255, 255, 255))
            if image.mode == "P":
                image = image.convert("RGBA")
            rgb_image.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
            image = rgb_image
        elif image.mode != "RGB":
            image = image.convert("RGB")
        
        # Resize if needed
        width, height = image.size
        max_width, max_height = max_size
        
        scale = min(max_width / width, max_height / height)
        if scale < 1.0:
            new_width = int(width * scale)
            new_height = int(height * scale)
            image = image.resize((new_width, new_height), Image.Resampling.LANCZOS)
        
        # Generate unique filename
        filename = f"{uuid.uuid4()}.jpg"
        filepath = UPLOAD_DIR / filename
        
        # Save as JPEG
        image.save(filepath, "JPEG", quality=85, optimize=True)
        
        return filename
    except Exception as e:
        print(f"  [ERROR] Image processing error: {str(e)}")
        return None


def replace_item_images(replace_all: bool = False):
    """
    Replace placeholder images with real product images
    """
    db = SessionLocal()
    try:
        # Get all items
        if replace_all:
            items = db.query(Item).filter(Item.is_deleted == False).all()
            print(f"Found {len(items)} items. Replacing all images...")
        else:
            # Only replace items that have placeholder images (those starting with /api/upload/items/)
            items = db.query(Item).filter(
                Item.is_deleted == False,
                Item.image_url.isnot(None),
                Item.image_url != ''
            ).all()
            # Filter to only items with placeholder images (UUID-based filenames)
            items = [item for item in items if item.image_url and '/api/upload/items/' in item.image_url]
            print(f"Found {len(items)} items with placeholder images. Replacing with real images...")
        
        if not items:
            print("No items found to update.")
            return
        
        items_updated = 0
        items_failed = 0
        
        for i, item in enumerate(items, 1):
            try:
                print(f"[{i}/{len(items)}] Processing: {item.name} ({item.item_number})...")
                
                # Generate search query
                search_query = get_search_query(item.name, item.category)
                print(f"  Search query: {search_query}")
                
                # Try to fetch image from Unsplash first
                image_data = fetch_image_from_unsplash(search_query)
                
                # If Unsplash fails, try Pexels
                if not image_data and PEXELS_API_KEY:
                    print("  Trying Pexels API...")
                    image_data = fetch_image_from_pexels(search_query)
                
                if not image_data:
                    print(f"  [SKIP] Could not fetch image for {item.name}")
                    items_failed += 1
                    continue
                
                # Process and save image
                filename = process_and_save_image(image_data)
                if not filename:
                    print(f"  [SKIP] Could not process image for {item.name}")
                    items_failed += 1
                    continue
                
                # Update item with new image URL
                item.image_url = f"/api/upload/items/{filename}"
                db.flush()
                items_updated += 1
                print(f"  [OK] Replaced image for: {item.name}")
                
                # Small delay to respect API rate limits
                import time
                time.sleep(0.5)  # 0.5 second delay between requests
                
            except Exception as e:
                print(f"  [ERROR] Failed to replace image for {item.name}: {str(e)}")
                items_failed += 1
                continue
        
        db.commit()
        print(f"\n[SUCCESS] Successfully replaced images for {items_updated} items!")
        if items_failed > 0:
            print(f"[INFO] {items_failed} items could not be updated (API limits or errors)")
        
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Error replacing images: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Replace item images with real product images")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Replace all item images (not just placeholders)"
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("Item Image Replacement Script")
    print("=" * 60)
    print("\nThis script will replace placeholder images with real product images")
    print("from Unsplash (free stock photos).")
    print("\nNote: For better results, you can:")
    print("  1. Get a free Unsplash API key: https://unsplash.com/developers")
    print("  2. Set it as environment variable: UNSPLASH_ACCESS_KEY=your_key")
    print("  3. Or get a Pexels API key: https://www.pexels.com/api/")
    print("  4. Set it as environment variable: PEXELS_API_KEY=your_key")
    print("\nWithout API keys, the script will work but with rate limits.")
    print("=" * 60)
    print()
    
    replace_item_images(replace_all=args.all)

