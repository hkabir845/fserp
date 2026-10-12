from pathlib import Path
v = Path(r"I:/ITProjects/FSERP/backend/api/views/aquaculture_views.py").read_text(encoding="utf-8")
# find finalize endpoint and create response
i = v.find("finalize_aquaculture_fish_sale_to_invoice")
print("call sites context:")
start=0
while True:
    i = v.find("finalize_aquaculture_fish_sale_to_invoice", start)
    if i<0: break
    print(v[i-120:i+80].replace("\n"," "))
    print("---")
    start=i+1
# after sale save, is finalize called?
i = v.find("s = AquacultureFishSale(")
# find next 80 lines after save
j = v.find("s.save()", i)
print(v[j:j+1500])
