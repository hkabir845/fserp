from pathlib import Path
# Confirm sale create does not call bio relief; finalize does
sa = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_sale_accounting.py").read_text(encoding="utf-8")
print("bio in finalize file", "sync_aquaculture_fish_sale_bio_relief" in sa)
# stock includes sales without invoice filter
st = Path(r"I:/ITProjects/FSERP/backend/api/services/aquaculture_stock_service.py").read_text(encoding="utf-8")
i = st.find("AquacultureFishSale.objects.filter")
print(st[i:i+450])
# mirror sale exclusion in stock
print("exclude transfer-sourced sales in stock?", "source_fish_pond_transfer_line" in st[i:i+2000])
print(st[st.find("source_fish_pond_transfer_line"):st.find("source_fish_pond_transfer_line")+250] if "source_fish_pond_transfer_line" in st else "")
