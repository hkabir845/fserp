from api.models import AquacultureBiomassSample, AquacultureProductionCycle

CID = 2
POND = 14
CY = 22


def main() -> None:
    cy = AquacultureProductionCycle.objects.get(pk=CY)
    print(f"C22 id={cy.id} code={cy.code} name={cy.name!r} start={cy.start_date} end={cy.end_date}")
    qs = AquacultureBiomassSample.objects.filter(
        company_id=CID, pond_id=POND, production_cycle_id=CY
    ).order_by("sample_date", "id")
    print(f"samples on cycle 22: {qs.count()}")
    for s in qs:
        print(
            f"  id={s.id} {s.sample_date} sp={s.fish_species} "
            f"seine={s.estimated_fish_count}/{s.estimated_total_weight_kg} "
            f"avg={s.avg_weight_kg} extrap={s.extrapolated_biomass_kg} "
            f"lot_bill={s.source_bill_line_id} lot_xfer={s.source_fish_pond_transfer_line_id} "
            f"sale={s.source_fish_sale_id}"
        )

    print("\nAll tilapia samples on Ashari-2 (any cycle), newest first:")
    for s in AquacultureBiomassSample.objects.filter(
        company_id=CID, pond_id=POND, fish_species="tilapia"
    ).order_by("-sample_date", "-id")[:15]:
        print(
            f"  id={s.id} {s.sample_date} cy={s.production_cycle_id} "
            f"seine={s.estimated_fish_count}/{s.estimated_total_weight_kg} avg={s.avg_weight_kg}"
        )


if __name__ == "__main__":
    main()
