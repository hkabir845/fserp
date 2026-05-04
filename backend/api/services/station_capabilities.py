"""Station operating profile: fuel forecourt vs aquaculture/shop-only hubs."""
from __future__ import annotations

from django.http import JsonResponse

from api.models import Island, Station, Tank


def require_fuel_forecourt_station(company_id: int, station_id: int) -> JsonResponse | None:
    """
    Enforce that forecourt infrastructure (tanks, islands) is only attached to fuel retail stations.
    Returns a JsonResponse error or None if OK.
    """
    st = Station.objects.filter(pk=station_id, company_id=company_id).first()
    if not st:
        return JsonResponse({"detail": "Station not found"}, status=400)
    if not getattr(st, "operates_fuel_retail", True):
        return JsonResponse(
            {
                "detail": (
                    "This station is configured without fuel forecourt (aquaculture / shop hub). "
                    "Assign tanks and islands only to sites that operate underground fuel, "
                    "or edit the station and enable fuel forecourt."
                )
            },
            status=400,
        )
    return None


def require_island_on_fuel_forecourt(company_id: int, island_id: int) -> JsonResponse | None:
    """Forecourt islands (dispensers, meters) must sit on a fuel-retail station."""
    isl = Island.objects.filter(pk=island_id, company_id=company_id).select_related("station").first()
    if not isl:
        return JsonResponse({"detail": "Island not found"}, status=400)
    return require_fuel_forecourt_station(company_id, isl.station_id)


def reconcile_station_fuel_flags_for_company(company_id: int) -> int:
    """
    Set operates_fuel_retail=True for stations that have fuel forecourt assets (tanks or islands) but
    were left False (e.g. after data import, pull_master reassignment, or pre-migration rows).

    Returns the number of station rows updated.
    """
    n = 0
    for s in Station.objects.filter(company_id=company_id, operates_fuel_retail=False).iterator():
        has_assets = Tank.objects.filter(station_id=s.id, company_id=company_id).exists() or Island.objects.filter(
            station_id=s.id, company_id=company_id
        ).exists()
        if has_assets:
            s.operates_fuel_retail = True
            s.save(update_fields=["operates_fuel_retail"])
            n += 1
    return n
