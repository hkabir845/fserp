import json
from decimal import Decimal

import pytest

from api.models import Bill, BillLine, Payment, Vendor, JournalEntry, JournalEntryLine
from api.services.contact_ledgers import vendor_ap_balance
from tests.conftest import seed_min_gl_accounts

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize('category,kind,value,base,feed', [
    ('feed', 'percent', '5', '1000', '50'),
    ('medicine', 'amount', '50', '0', '50'),
    ('feed', 'amount', '', '', '0'),
])
def test_discount_payment_and_edit_delete(api_client, auth_admin_headers, company_tenant,
                                        category, kind, value, base, feed):
    seed_min_gl_accounts(company_tenant)
    vendor = Vendor.objects.create(company=company_tenant, company_name='Supplier',
        supplier_category=category, opening_balance=1000, current_balance=1000)
    transport = Decimal('20') if value else Decimal('0')
    net = Decimal('1000') - Decimal(feed) - transport
    body = dict(vendor_id=vendor.id, amount=str(net), payment_date='2026-10-23',
        payment_method='cash', feed_discount_type=kind, feed_discount_value=value,
        discount_mrp_base=base, transport_discount_amount=str(transport))
    response = api_client.post('/api/payments/made/', data=json.dumps(body),
        content_type='application/json', **auth_admin_headers)
    assert response.status_code == 201, response.content
    data = response.json()
    payment = Payment.objects.get(pk=data['id'])
    assert payment.amount == net
    assert payment.settlement_amount == Decimal('1000')
    assert vendor_ap_balance(company_tenant.id, vendor.id) == 0
    vendor.refresh_from_db()
    assert vendor.current_balance == 0
    journal = JournalEntry.objects.get(entry_number=f'AUTO-PAY-{payment.id}-MADE', company=company_tenant)
    lines = JournalEntryLine.objects.filter(journal_entry=journal)
    assert sum(line.debit for line in lines) == sum(line.credit for line in lines) == Decimal('1000')
    assert sum(line.credit for line in lines if line.account.account_code == '5130') == Decimal(feed)
    assert sum(line.credit for line in lines if line.account.account_code == '5131') == transport
    # A metadata-only edit must preserve discounts and the gross A/P settlement.
    response = api_client.put(f'/api/payments/{payment.id}/', data=json.dumps({'memo': 'Updated'}),
        content_type='application/json', **auth_admin_headers)
    assert response.status_code == 200, response.content
    payment.refresh_from_db()
    assert payment.settlement_amount == Decimal('1000')
    assert vendor_ap_balance(company_tenant.id, vendor.id) == 0
    response = api_client.delete(f'/api/payments/{payment.id}/', **auth_admin_headers)
    assert response.status_code == 200, response.content
    vendor.refresh_from_db()
    assert vendor.current_balance == Decimal('1000')
    assert vendor_ap_balance(company_tenant.id, vendor.id) == Decimal('1000')
    assert not JournalEntry.objects.filter(pk=journal.pk).exists()


@pytest.mark.parametrize('category,fields', [
    ('general', {'feed_discount_value': '10'}),
    ('equipment', {'transport_discount_amount': '10'}),
    ('feed', {'feed_discount_type': 'percent', 'feed_discount_value': '101', 'discount_mrp_base': '100'}),
    ('feed', {'feed_discount_type': 'percent', 'feed_discount_value': '5'}),
    ('medicine', {'transport_discount_amount': '-1'}),
    ('feed', {'feed_discount_value': 'NaN'}),
    ('feed', {'transport_discount_amount': 'Infinity'}),
])
def test_invalid_discounts_rejected(api_client, auth_admin_headers, company_tenant, category, fields):
    vendor = Vendor.objects.create(company=company_tenant, company_name='Supplier', supplier_category=category)
    response = api_client.post('/api/payments/made/',
        data=json.dumps(dict(vendor_id=vendor.id, amount='100', **fields)),
        content_type='application/json', **auth_admin_headers)
    assert response.status_code == 400, response.content
    assert not Payment.objects.filter(vendor=vendor).exists()


def test_discount_settles_bill_and_reopens_on_delete(api_client, auth_admin_headers, company_tenant):
    from api.services.gl_posting import post_bill_journal

    seed_min_gl_accounts(company_tenant)
    vendor = Vendor.objects.create(company=company_tenant, company_name='Feed', supplier_category='feed')
    bill = Bill.objects.create(company=company_tenant, vendor=vendor, bill_number='DISC-BILL',
        bill_date='2026-10-23', status='open', subtotal=1000, total=1000)
    BillLine.objects.create(bill=bill, description='Feed', quantity=1, unit_price=1000,
        amount=1000, charge_to_head_office=True)
    assert post_bill_journal(company_tenant.id, bill)
    body = dict(vendor_id=vendor.id, amount='930', payment_date='2026-10-23', payment_method='cash',
        feed_discount_type='percent', feed_discount_value='5', discount_mrp_base='1000',
        transport_discount_amount='20', bill_allocations=[{'bill_id': bill.id, 'amount': '1000'}])
    response = api_client.post('/api/payments/made/', data=json.dumps(body),
        content_type='application/json', **auth_admin_headers)
    assert response.status_code == 201, response.content
    payment_id = response.json()['id']
    bill.refresh_from_db()
    assert bill.status == 'paid'
    assert vendor_ap_balance(company_tenant.id, vendor.id) == 0
    # Changing the discount and net cash leaves the bill fully settled.
    response = api_client.put(f'/api/payments/{payment_id}/',
        data=json.dumps({'feed_discount_value': '10', 'amount': '880'}),
        content_type='application/json', **auth_admin_headers)
    assert response.status_code == 200, response.content
    payment = Payment.objects.get(pk=payment_id)
    assert payment.feed_discount_amount == Decimal('100')
    assert payment.settlement_amount == Decimal('1000')
    assert vendor_ap_balance(company_tenant.id, vendor.id) == 0
    response = api_client.delete(f'/api/payments/{payment_id}/', **auth_admin_headers)
    assert response.status_code == 200, response.content
    bill.refresh_from_db()
    assert bill.status == 'open'
    assert vendor_ap_balance(company_tenant.id, vendor.id) == Decimal('1000')
