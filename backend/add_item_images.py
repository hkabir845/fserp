"""
Script to add sample images for all items in the database
Run this from the backend directory: python add_item_images.py
"""
import sys
from pathlib import Path

# Add the backend directory to the path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

import os
import uuid
from PIL import Image, ImageDraw, ImageFont
import io
from app.database import SessionLocal
from app.models.item import Item
from app.api.upload import UPLOAD_DIR

def create_placeholder_image(item_name: str, category: str = None) -> Image.Image:
    """
    Create a placeholder image with item name and category
    """
    # Create a 400x400 image with a light background
    width, height = 400, 400
    
    # Choose background color based on category
    colors = {
        'snacks': (255, 223, 186),  # Light orange
        'beverages': (186, 225, 255),  # Light blue
        'tobacco': (200, 200, 200),  # Light gray
        'personal care': (255, 218, 255),  # Light pink
        'stationery': (218, 255, 218),  # Light green
        'electronics': (255, 255, 186),  # Light yellow
        'default': (240, 240, 240)  # Light gray
    }
    
    # Determine color based on category or item name
    bg_color = colors.get('default')
    if category:
        category_lower = category.lower()
        for key, color in colors.items():
            if key in category_lower:
                bg_color = color
                break
    
    # Check item name for hints
    name_lower = item_name.lower()
    if any(word in name_lower for word in ['chip', 'biscuit', 'noodle', 'snack']):
        bg_color = colors['snacks']
    elif any(word in name_lower for word in ['cola', 'pepsi', 'water', 'drink', 'beverage', 'energy']):
        bg_color = colors['beverages']
    elif any(word in name_lower for word in ['cigarette', 'tobacco']):
        bg_color = colors['tobacco']
    elif any(word in name_lower for word in ['soap', 'shampoo', 'toothpaste', 'care']):
        bg_color = colors['personal care']
    elif any(word in name_lower for word in ['pen', 'notebook', 'stationery']):
        bg_color = colors['stationery']
    elif any(word in name_lower for word in ['battery', 'electronic']):
        bg_color = colors['electronics']
    
    # Create image
    image = Image.new('RGB', (width, height), bg_color)
    draw = ImageDraw.Draw(image)
    
    # Try to use a font, fallback to default if not available
    try:
        # Try to use a system font
        font_large = ImageFont.truetype("arial.ttf", 32)
        font_small = ImageFont.truetype("arial.ttf", 20)
    except:
        try:
            font_large = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 32)
            font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
        except:
            # Use default font
            font_large = ImageFont.load_default()
            font_small = ImageFont.load_default()
    
    # Draw item name (split into lines if too long)
    text = item_name
    words = text.split()
    lines = []
    current_line = []
    
    for word in words:
        test_line = ' '.join(current_line + [word])
        bbox = draw.textbbox((0, 0), test_line, font=font_large)
        if bbox[2] - bbox[0] < width - 40:
            current_line.append(word)
        else:
            if current_line:
                lines.append(' '.join(current_line))
            current_line = [word]
    if current_line:
        lines.append(' '.join(current_line))
    
    # Draw text centered
    y_offset = (height - (len(lines) * 40)) // 2
    for i, line in enumerate(lines):
        bbox = draw.textbbox((0, 0), line, font=font_large)
        text_width = bbox[2] - bbox[0]
        x = (width - text_width) // 2
        y = y_offset + (i * 40)
        draw.text((x, y), line, fill=(50, 50, 50), font=font_large)
    
    # Draw category if available
    if category:
        bbox = draw.textbbox((0, 0), category, font=font_small)
        text_width = bbox[2] - bbox[0]
        x = (width - text_width) // 2
        y = height - 40
        draw.text((x, y), category, fill=(100, 100, 100), font=font_small)
    
    return image


def resize_and_save_image(image: Image.Image, max_size: tuple = (800, 800)) -> str:
    """
    Resize image and save it, returning the filename
    """
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


def add_images_to_items():
    db = SessionLocal()
    try:
        # Get all items without images
        items = db.query(Item).filter(
            Item.is_deleted == False,
            (Item.image_url == None) | (Item.image_url == '')
        ).all()
        
        if not items:
            print("No items found without images.")
            return
        
        print(f"Found {len(items)} items without images. Adding sample images...")
        
        items_updated = 0
        
        for item in items:
            try:
                # Create placeholder image
                image = create_placeholder_image(item.name, item.category)
                
                # Resize and save
                filename = resize_and_save_image(image)
                
                # Update item with image URL
                item.image_url = f"/api/upload/items/{filename}"
                
                db.flush()
                items_updated += 1
                print(f"[OK] Added image for: {item.name} ({item.item_number})")
                
            except Exception as e:
                print(f"[ERROR] Failed to add image for {item.name}: {str(e)}")
                continue
        
        db.commit()
        print(f"\n[SUCCESS] Successfully added images to {items_updated} items!")
        
    except Exception as e:
        db.rollback()
        print(f"[ERROR] Error adding images: {str(e)}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    add_images_to_items()

