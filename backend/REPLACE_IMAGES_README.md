# Replace Item Images with REAL Product Photos

This guide explains how to replace placeholder images with **REAL product images** (actual product photos, not stock photos).

## Option 1: Automated Script (Recommended)

### Step 1: Get API Keys (Free)

#### Google Custom Search API (Best Results)
1. Go to https://developers.google.com/custom-search/v1/overview
2. Click "Get a Key" and create a project
3. Enable "Custom Search API"
4. Get your API key
5. Create a Custom Search Engine at https://cse.google.com/cse/all
   - Add sites to search (or leave blank to search entire web)
   - Get your Search Engine ID (CSE ID)

#### Bing Image Search API (Alternative)
1. Go to https://www.microsoft.com/en-us/bing/apis/bing-image-search-api
2. Get a free API key (2000 requests/month free)

### Step 2: Set Environment Variables

**Windows PowerShell:**
```powershell
$env:GOOGLE_API_KEY="your_google_api_key"
$env:GOOGLE_CSE_ID="your_cse_id"
# OR
$env:BING_API_KEY="your_bing_api_key"
```

**Windows CMD:**
```cmd
set GOOGLE_API_KEY=your_google_api_key
set GOOGLE_CSE_ID=your_cse_id
```

**Linux/Mac:**
```bash
export GOOGLE_API_KEY="your_google_api_key"
export GOOGLE_CSE_ID="your_cse_id"
```

### Step 3: Run the Script

```bash
cd backend
python replace_item_images_real.py
```

This will:
- Find items with placeholder images
- Search for REAL product photos using Google/Bing
- Download and process the images
- Update your database

## Option 2: Manual Upload (Best Quality)

1. Go to `/items` page in your application
2. Click "Edit" on each item
3. Click "Upload Image" and select the real product photo
4. Save the item

## Option 3: Bulk Upload via Script

If you have a folder of product images named by item number or name:

1. Place images in a folder (e.g., `product_images/`)
2. Name files as: `ITEM-001.jpg`, `ITEM-002.jpg`, etc.
3. Run a custom script to match and upload

## Tips for Best Results

1. **Use Barcodes**: Items with barcodes get the most accurate product images from product databases
2. **API Keys**: Google Custom Search gives the best results for real product photos
3. **Image Quality**: The script automatically resizes to 800x800px and optimizes
4. **Rate Limits**: Script includes delays to respect API rate limits

## Troubleshooting

- **No API keys?** The script will try Open Product Data (barcode-based) but results are limited
- **Rate limits?** Add delays between requests or use API keys with higher limits
- **Wrong images?** Manually upload correct images via the web interface

