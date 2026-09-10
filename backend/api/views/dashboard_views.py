"""Dashboard API."""
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from django.db.models import Sum
from django.utils import timezone

from api.utils.auth import auth_required, company_context_error_response, get_company_id
from api.models import Customer, Invoice


@auth_required
@require_GET
def dashboard_stats(request):
    """Return dashboard stats for current company."""
    cid = get_company_id(request)
    err = company_context_error_response(request)
    if err:
        return err
    # Match POS/invoice defaults: local business date (TIME_ZONE), not UTC from timezone.now().date().
    today = timezone.localdate()
    if cid:
        # Drafts are not sales yet and voids are cancelled sales; counting either overstates
        # the headline revenue figures against the income statement.
        today_qs = Invoice.objects.filter(
            company_id=cid, invoice_date=today
        ).exclude(status__in=("draft", "void"))
        today_sales = float((today_qs.aggregate(s=Sum("total"))["s"]) or 0)
        today_sales_count = today_qs.count()
    else:
        today_sales = 0.0
        today_sales_count = 0
    _recognised = (
        Invoice.objects.filter(company_id=cid).exclude(status__in=("draft", "void"))
        if cid
        else None
    )
    total_invoices = _recognised.count() if cid else 0
    total_revenue = float((_recognised.aggregate(s=Sum("total"))["s"]) or 0) if cid else 0
    total_customers = Customer.objects.filter(company_id=cid).count() if cid else 0
    return JsonResponse({
        "today_sales": today_sales,
        "today_sales_count": today_sales_count,
        "total_customers": total_customers,
        "total_invoices": total_invoices,
        "total_revenue": total_revenue,
    })

