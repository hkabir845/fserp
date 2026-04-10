"""
Script to replace item images with REAL product images
Uses multiple sources to find actual product photos:
1. Google Custom Search API (for real product images)
2. Bing Image Search API (for real product images)
3. Product image databases

Run this from the backend directory: python replace_item_images_real.py

For best results, you'll need API keys (all free):
- Google Custom Search API: https://developers.google.com/custom-search/v1/overview
- Bing Image Search API: https://www.microsoft.com/en-us/bing/apis/bing-image-search-api

Or you can manually upload images using the web interface at /items
"""
import sys
from pathlib import Path
import os
import uuid
import requests
from PIL import Image
import io
import time

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from app.database import SessionLocal
from app.models.item import Item
from app.api.upload import UPLOAD_DIR

# API Keys (set as environment variables)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", None)
GOOGLE_CSE_ID = os.getenv("GOOGLE_CSE_ID", None)  # Custom Search Engine ID
BING_API_KEY = os.getenv("BING_API_KEY", None)

# Google Custom Search API
GOOGLE_SEARCH_URL = "https://www.googleapis.com/customsearch/v1"

# Bing Image Search API
BING_SEARCH_URL = "https://api.bing.microsoft.com/v7.0/images/search"


def get_search_query(item_name: str, category: str = None, barcode: str = None) -> str:
    """
    Generate a search query optimized for finding real product images
    """
    # Use barcode if available (most accurate)
    if barcode:
        return f"{item_name} barcode {barcode}"
    
    # Clean and enhance item name for product search
    name = item_name.strip()
    
    # Add "product" or "packaging" to get real product photos
    if category:
        return f"{name} {category} product packaging"
    
    # Add common product photo keywords
    return f"{name} product photo packaging"


def fetch_image_from_google(query: str) -> bytes:
    """
    Fetch real product image from Google Custom Search
    """
    if not GOOGLE_API_KEY or not GOOGLE_CSE_ID:
        return None
    
    try:
        params = {
            "key": GOOGLE_API_KEY,
            "cx": GOOGLE_CSE_ID,
            "q": query,
            "searchType": "image",
            "num": 1,
            "safe": "active",
            "imgSize": "large",
            "imgType": "photo"
        }
        
        response = requests.get(GOOGLE_SEARCH_URL, params=params, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("items") and len(data["items"]) > 0:
                image_url = data["items"][0]["link"]
                # Download the image
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
                img_response = requests.get(image_url, headers=headers, timeout=15, allow_redirects=True)
                if img_response.status_code == 200:
                    content_type = img_response.headers.get('content-type', '')
                    if content_type.startswith('image/'):
                        return img_response.content
    except Exception as e:
        print(f"  [WARN] Google Search API error: {str(e)}")
    
    return None


def fetch_image_from_bing(query: str) -> bytes:
    """
    Fetch real product image from Bing Image Search
    """
    if not BING_API_KEY:
        return None
    
    try:
        headers = {
            "Ocp-Apim-Subscription-Key": BING_API_KEY
        }
        params = {
            "q": query,
            "count": 1,
            "imageType": "Photo",
            "size": "Large",
            "safeSearch": "Strict"
        }
        
        response = requests.get(BING_SEARCH_URL, headers=headers, params=params, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("value") and len(data["value"]) > 0:
                image_url = data["value"][0]["contentUrl"]
                # Download the image
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
                img_response = requests.get(image_url, headers=headers, timeout=15, allow_redirects=True)
                if img_response.status_code == 200:
                    content_type = img_response.headers.get('content-type', '')
                    if content_type.startswith('image/'):
                        return img_response.content
    except Exception as e:
        print(f"  [WARN] Bing Search API error: {str(e)}")
    
    return None


def fetch_image_from_product_db(item_name: str, barcode: str = None) -> bytes:
    """
    Try to fetch from product databases (Open Product Data, etc.)
    """
    # Open Product Data API (free, no key required)
    try:
        if barcode:
            # Try Open Product Data by barcode
            url = f"https://world.openfoodfacts.org/api/v0/product/{barcode}.json"
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == 1 and data.get("product"):
                    image_url = data["product"].get("image_url") or data["product"].get("image_front_url")
                    if image_url:
                        img_response = requests.get(image_url, timeout=15)
                        if img_response.status_code == 200:
                            return img_response.content
    except Exception as e:
        pass
    
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
        image.save(filepath, "JPEG", quality=90, optimize=True)
        
        return filename
    except Exception as e:
        print(f"  [ERROR] Image processing error: {str(e)}")
        return None


def replace_item_images_with_real(replace_all: bool = False):
    """
    Replace placeholder images with REAL product images
    """
    db = SessionLocal()
    try:
        # Get all items
        if replace_all:
            items = db.query(Item).filter(Item.is_deleted == False).all()
            print(f"Found {len(items)} items. Replacing with REAL product images...")
        else:
            # Only replace items that have placeholder images
            items = db.query(Item).filter(
                Item.is_deleted == False,
                Item.image_url.isnot(None),
                Item.image_url != ''
            ).all()
            items = [item for item in items if item.image_url and '/api/upload/items/' in item.image_url]
            print(f"Found {len(items)} items with placeholder images. Replacing with REAL product images...")
        
        if not items:
            print("No items found to update.")
            return
        
        # Check for API keys
        if not GOOGLE_API_KEY and not BING_API_KEY:
            print("\n" + "="*60)
            print("WARNING: No API keys configured!")
            print("="*60)
            print("To get REAL product images, you need API keys:")
            print("\n1. Google Custom Search API (Recommended):")
            print("   - Get API key: https://developers.google.com/custom-search/v1/overview")
            print("   - Create Custom Search Engine: https://cse.google.com/cse/all")
            print("   - Set environment variables:")
            print("     GOOGLE_API_KEY=your_key")
            print("     GOOGLE_CSE_ID=your_cse_id")
            print("\n2. Bing Image Search API (Alternative):")
            print("   - Get API key: https://www.microsoft.com/en-us/bing/apis/bing-image-search-api")
            print("   - Set environment variable:")
            print("     BING_API_KEY=your_key")
            print("\n3. Or manually upload images via the web interface at /items")
            print("="*60)
            print("\nTrying to use Open Product Data (barcode-based, limited)...")
            print()
        
        items_updated = 0
        items_failed = 0
        
        for i, item in enumerate(items, 1):
            try:
                print(f"[{i}/{len(items)}] Processing: {item.name} ({item.item_number})...")
                
                # Generate search query
                search_query = get_search_query(item.name, item.category, item.barcode)
                print(f"  Search query: {search_query}")
                
                image_data = None
                
                # Try barcode-based product database first (most accurate)
                if item.barcode:
                    print("  Trying product database by barcode...")
                    image_data = fetch_image_from_product_db(item.name, item.barcode)
                    if image_data:
                        print("  [OK] Found in product database!")
                
                # Try Google Custom Search
                if not image_data and GOOGLE_API_KEY:
                    print("  Trying Google Custom Search...")
                    image_data = fetch_image_from_google(search_query)
                    if image_data:
                        print("  [OK] Found via Google Search!")
                
                # Try Bing Image Search
                if not image_data and BING_API_KEY:
                    print("  Trying Bing Image Search...")
                    image_data = fetch_image_from_bing(search_query)
                    if image_data:
                        print("  [OK] Found via Bing Search!")
                
                if not image_data:
                    print(f"  [SKIP] Could not find real product image for {item.name}")
                    print(f"  [TIP] You can manually upload an image at /items page")
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
                print(f"  [SUCCESS] Replaced with REAL product image!")
                
                # Rate limiting
                time.sleep(1)  # 1 second delay between requests
                
            except Exception as e:
                print(f"  [ERROR] Failed to replace image for {item.name}: {str(e)}")
                items_failed += 1
                continue
        
        db.commit()
        print(f"\n" + "="*60)
        print(f"[SUCCESS] Successfully replaced {items_updated} items with REAL product images!")
        if items_failed > 0:
            print(f"[INFO] {items_failed} items could not be updated")
            print(f"[TIP] You can manually upload images for these items at /items page")
        print("="*60)
        
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Error replacing images: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Replace item images with REAL product images")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Replace all item images (not just placeholders)"
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("REAL Product Image Replacement Script")
    print("=" * 60)
    print("\nThis script will replace placeholder images with REAL product images")
    print("from Google Search, Bing Search, or product databases.")
    print("\nFor best results, configure API keys (see instructions above).")
    print("=" * 60)
    print()
    
    replace_item_images_with_real(replace_all=args.all)

