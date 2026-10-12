from api.models import AquacultureBiomassSample

s = AquacultureBiomassSample.objects.filter(pk=394).first()
if not s:
    print("vps GONE")
else:
    print("vps EXISTS", s.estimated_fish_count, s.sample_date, s.pond_id)
    s.delete()
    print("vps DELETED 394")
