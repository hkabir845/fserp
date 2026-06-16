"""
Feed mill quality laboratory — aligned with ISO/IEC 17025-style traceability concepts:
- Analyte (parameter) catalog with units and method families
- Specifications (supplier COA, formulation release, regulatory / feed-grade, internal monitoring)
- Samples (chain of identity from raw material through finished feed)
- Results with min/max snapshot and conformant / OOS (out-of-spec) flags

Industry practice: proximate analysis, mycotoxins (aflatoxin), heavy metals, salmonella/E.coli screening,
physical pellet tests (PDI, hardness), moisture, cross-check vs formulation targets.
"""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.shared.base import TenantBase


class LabParameter(TenantBase):
    """Master list of analytes / tests (tenant-scoped catalog)."""

    __tablename__ = "lab_parameters"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_lab_parameters_tenant_code"),)

    code = Column(String, nullable=False, index=True)  # e.g. PROTEIN_CP, AF_B1_PPBT, MOISTURE
    name = Column(String, nullable=False)
    unit = Column(String, nullable=True)  # %, mg/kg, ppm, kcal/kg, CFU/g
    category = Column(
        String,
        nullable=False,
        default="proximate",
    )  # proximate, minerals, vitamins, toxins, micro, physical, other
    method_family = Column(String, nullable=True)  # e.g. Kjeldahl/NIR, HPLC, AOAC ref
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    specification_lines = relationship("LabSpecificationLine", back_populates="parameter")
    results = relationship("LabResult", back_populates="parameter")


class LabSpecification(TenantBase):
    """
    A named set of limits: supplier COA envelope, formulation QC release,
    regulatory feed-grade envelope, or internal monitoring bands.
    """

    __tablename__ = "lab_specifications"

    name = Column(String, nullable=False)
    purpose = Column(
        String,
        nullable=False,
        default="formulation_release",
    )
    # supplier_coa | formulation_release | regulatory_grade | internal_monitoring | customer_agreement

    # Scope (at least one should be set for auto-matching; all optional for generic specs)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)
    ingredient_item_id = Column(Integer, ForeignKey("items.id"), nullable=True, index=True)
    feed_product_id = Column(Integer, ForeignKey("feed_products.id"), nullable=True, index=True)
    bom_id = Column(Integer, ForeignKey("feed_boms.id"), nullable=True, index=True)

    effective_from = Column(DateTime, nullable=True)
    effective_to = Column(DateTime, nullable=True)
    version = Column(String, nullable=True)  # e.g. 2026-Q1
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)

    lines = relationship(
        "LabSpecificationLine",
        back_populates="specification",
        cascade="all, delete-orphan",
    )


class LabSpecificationLine(TenantBase):
    """One analyte line with lower/upper (inclusive) limits on specification."""

    __tablename__ = "lab_specification_lines"

    specification_id = Column(Integer, ForeignKey("lab_specifications.id"), nullable=False, index=True)
    parameter_id = Column(Integer, ForeignKey("lab_parameters.id"), nullable=False, index=True)

    lower_limit = Column(Numeric(18, 6), nullable=True)
    upper_limit = Column(Numeric(18, 6), nullable=True)
    target_value = Column(Numeric(18, 6), nullable=True)
    unit_override = Column(String, nullable=True)  # if different from parameter default

    is_critical = Column(Boolean, nullable=False, default=False)  # food safety / legal limit
    notes = Column(Text, nullable=True)

    specification = relationship("LabSpecification", back_populates="lines")
    parameter = relationship("LabParameter", back_populates="specification_lines")


class LabSample(TenantBase):
    """Physical / logical sample logged into LIMS-style workflow."""

    __tablename__ = "lab_samples"
    __table_args__ = (UniqueConstraint("tenant_id", "sample_number", name="uq_lab_samples_tenant_number"),)

    sample_number = Column(String, nullable=False, index=True)

    sample_type = Column(
        String,
        nullable=False,
        default="finished_feed",
    )
    # incoming_raw_material | finished_feed | in_process | retention | supplier_verification | complaint_investigation | calibration

    status = Column(
        String,
        nullable=False,
        default="logged",
    )
    # logged | received | in_progress | completed | on_hold | cancelled

    # Optional FKs — describe what is being tested
    item_id = Column(Integer, ForeignKey("items.id"), nullable=True, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=True, index=True)
    feed_product_id = Column(Integer, ForeignKey("feed_products.id"), nullable=True, index=True)
    production_order_id = Column(Integer, ForeignKey("production_orders.id"), nullable=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True, index=True)

    lab_specification_id = Column(Integer, ForeignKey("lab_specifications.id"), nullable=True, index=True)

    lot_reference = Column(String, nullable=True)  # GRN / batch / silo ticket
    sampling_point = Column(String, nullable=True)  # e.g. mixer out, cooler, bag line
    sampled_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    priority = Column(String, nullable=False, default="normal")  # low, normal, high, critical
    chain_of_custody_notes = Column(Text, nullable=True)
    overall_compliant = Column(Boolean, nullable=True)  # null until all critical results evaluated

    specification = relationship("LabSpecification", foreign_keys=[lab_specification_id])
    results = relationship("LabResult", back_populates="sample", cascade="all, delete-orphan")


class LabResult(TenantBase):
    """Single analyte result with snapshot limits for audit trail."""

    __tablename__ = "lab_results"
    __table_args__ = (
        UniqueConstraint("sample_id", "parameter_id", name="uq_lab_results_sample_parameter"),
    )

    sample_id = Column(Integer, ForeignKey("lab_samples.id"), nullable=False, index=True)
    parameter_id = Column(Integer, ForeignKey("lab_parameters.id"), nullable=False, index=True)

    result_numeric = Column(Numeric(18, 6), nullable=True)
    result_text = Column(String, nullable=True)  # absent/present, qualitative

    # Snapshot at release (from spec line or manual)
    lower_applied = Column(Numeric(18, 6), nullable=True)
    upper_applied = Column(Numeric(18, 6), nullable=True)
    target_applied = Column(Numeric(18, 6), nullable=True)

    compliant = Column(Boolean, nullable=True)  # False = OOS
    is_critical = Column(Boolean, nullable=False, default=False)

    method_reference = Column(String, nullable=True)
    equipment_id = Column(String, nullable=True)
    tested_at = Column(DateTime, nullable=True)
    tested_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    deviation_notes = Column(Text, nullable=True)

    sample = relationship("LabSample", back_populates="results")
    parameter = relationship("LabParameter", back_populates="results")
