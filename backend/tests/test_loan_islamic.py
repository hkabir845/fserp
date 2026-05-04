"""Islamic financing terminology flag."""
from decimal import Decimal

import pytest
from django.test import TestCase

from api.models import Company, Loan, LoanCounterparty
from api.services.loan_islamic import loan_uses_islamic_terminology


@pytest.mark.django_db
class TestLoanIslamicTerminology(TestCase):
    def setUp(self):
        self.co = Company.objects.create(name="Co")
        self.cp = LoanCounterparty.objects.create(
            company=self.co,
            code="CP1",
            name="Bank",
            role_type="bank",
        )
        from api.models import ChartOfAccount

        self.pr = ChartOfAccount.objects.create(
            company=self.co,
            account_code="2000",
            account_name="Payable",
            account_type="liability",
            account_sub_type="loan_payable",
        )
        self.st = ChartOfAccount.objects.create(
            company=self.co,
            account_code="1000",
            account_name="Bank",
            account_type="asset",
            account_sub_type="checking",
        )

    def _loan(self, **kwargs):
        defaults = dict(
            company=self.co,
            loan_no="LN-TEST",
            direction=Loan.DIRECTION_BORROWED,
            status="draft",
            counterparty=self.cp,
            principal_account=self.pr,
            settlement_account=self.st,
            sanction_amount=Decimal("0"),
        )
        defaults.update(kwargs)
        return Loan.objects.create(**defaults)

    def test_conventional_general_false(self):
        lo = self._loan(banking_model=Loan.BANKING_CONVENTIONAL, product_type=Loan.PRODUCT_GENERAL)
        assert loan_uses_islamic_terminology(lo) is False

    def test_banking_model_islamic_true(self):
        lo = self._loan(banking_model=Loan.BANKING_ISLAMIC, product_type=Loan.PRODUCT_TERM_LOAN)
        assert loan_uses_islamic_terminology(lo) is True

    def test_islamic_deal_true_even_if_conventional_flag(self):
        lo = self._loan(banking_model=Loan.BANKING_CONVENTIONAL, product_type=Loan.PRODUCT_ISLAMIC_DEAL)
        assert loan_uses_islamic_terminology(lo) is True
