from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Numeric, Boolean, JSON
from sqlalchemy.orm import relationship
from app.shared.base import TenantBase

class Employee(TenantBase):
    __tablename__ = "employees"

    employee_code = Column(String, nullable=True, index=True)  # payroll / badge number
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    department = Column(String, nullable=True)
    designation = Column(String, nullable=True)
    join_date = Column(DateTime, nullable=False)
    bank_name = Column(String, nullable=True)
    bank_account_no = Column(String, nullable=True)
    bank_branch = Column(String, nullable=True)
    bank_routing_or_ifsc = Column(String, nullable=True)
    opening_balance = Column(Numeric(15, 2), nullable=False, default=0)
    opening_balance_as_of = Column(DateTime, nullable=True)
    gl_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)

    gl_account = relationship("Account", foreign_keys=[gl_account_id])
    
    salary_structure = relationship("SalaryStructure", back_populates="employee", uselist=False)
    payslips = relationship("Payslip", back_populates="employee")

class SalaryStructure(TenantBase):
    __tablename__ = "salary_structures"
    
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False, unique=True)
    basic = Column(Numeric(15, 2), nullable=False)
    allowances_json = Column(JSON, nullable=True)  # {"HRA": 5000, "DA": 3000}
    deductions_json = Column(JSON, nullable=True)  # {"PF": 1800, "TDS": 2000}
    effective_from = Column(DateTime, nullable=False)
    effective_to = Column(DateTime, nullable=True)
    
    employee = relationship("Employee", back_populates="salary_structure")

class PayrollRun(TenantBase):
    __tablename__ = "payroll_runs"
    
    run_number = Column(String, nullable=False, unique=True, index=True)
    period_month = Column(Integer, nullable=False)
    period_year = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="draft")  # draft, posted, cancelled
    run_date = Column(DateTime, nullable=False)
    
    payslips = relationship("Payslip", back_populates="payroll_run", cascade="all, delete-orphan")

class Payslip(TenantBase):
    __tablename__ = "payslips"
    
    payroll_run_id = Column(Integer, ForeignKey("payroll_runs.id"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    gross = Column(Numeric(15, 2), nullable=False)
    deduction = Column(Numeric(15, 2), nullable=False)
    net = Column(Numeric(15, 2), nullable=False)
    
    payroll_run = relationship("PayrollRun", back_populates="payslips")
    employee = relationship("Employee", back_populates="payslips")

