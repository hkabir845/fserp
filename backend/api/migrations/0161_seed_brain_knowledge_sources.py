# Seed curated industry knowledge for Company Brain RAG

from django.db import migrations


def seed_knowledge(apps, schema_editor):
    BrainKnowledgeSource = apps.get_model("api", "BrainKnowledgeSource")
    rows = [
        {
            "slug": "aquaculture-fcr-benchmark",
            "title": "Aquaculture FCR benchmark",
            "category": "aquaculture",
            "content_bn": (
                "সাধারণত tilapia/carp grow-out এ FCR ১.২–১.۸ ভালো; ১.৮+ হলে feed cost বেশি। "
                "Nursing phase এ FCR আলাদা — grow-out এর সাথে সরাসরি তুলনা করবেন না।"
            ),
            "content_en": (
                "Typical grow-out FCR for tilapia/carp is 1.2–1.8; above 1.8 suggests feed inefficiency. "
                "Nursing FCR differs — do not compare directly to grow-out."
            ),
            "source_url": "https://www.fao.org/fishery/en",
            "tags": ["aquaculture", "fcr", "feed"],
        },
        {
            "slug": "retail-inventory-turnover",
            "title": "Retail inventory turnover",
            "category": "retail",
            "content_bn": (
                "Fuel/convenience retail এ inventory turnover মাসে ২–৪ বার সাধারণ। "
                "Slow-moving SKU ৯০+ দিন stock এ থাকলে working capital bind করে।"
            ),
            "content_en": (
                "Fuel/convenience retail often turns inventory 2–4× monthly. "
                "SKUs idle 90+ days tie up working capital."
            ),
            "tags": ["inventory", "retail", "sales"],
        },
        {
            "slug": "ar-days-outstanding",
            "title": "Accounts receivable DSO",
            "category": "accounting",
            "content_bn": (
                "DSO (Days Sales Outstanding) ৩০–৪৫ দিনের মধ্যে রাখা ভালো practice। "
                "৬০+ দিন overdue হলে cash flow risk বাড়ে — collection policy tighten করুন।"
            ),
            "content_en": (
                "DSO of 30–45 days is a common target. Over 60 days overdue increases cash-flow risk."
            ),
            "tags": ["receivables", "accounting", "cash_flow"],
        },
        {
            "slug": "gross-margin-retail",
            "title": "Gross margin benchmarks",
            "category": "general",
            "content_bn": (
                "Retail gross margin industry অনুযায়ী ১৫–৩৫%। "
                "Aquaculture integrated business এ feed cost ও mortality margin ক compress করে।"
            ),
            "content_en": (
                "Retail gross margins often range 15–35% by category. "
                "Integrated aquaculture margins depend heavily on feed cost and mortality."
            ),
            "tags": ["profit", "sales", "general"],
        },
        {
            "slug": "hr-retention-sme",
            "title": "SME workforce retention",
            "category": "hr",
            "content_bn": (
                "SME তে annual turnover ২০–৩০% সাধারণ। "
                "Key pond/site staff turnover বেশি হলে operational consistency ক্ষতিগ্রস্ত হয়।"
            ),
            "content_en": (
                "SME annual turnover of 20–30% is common. High turnover of key site staff hurts operations."
            ),
            "tags": ["hr", "workforce"],
        },
    ]
    for row in rows:
        BrainKnowledgeSource.objects.update_or_create(slug=row["slug"], defaults=row)


def unseed_knowledge(apps, schema_editor):
    BrainKnowledgeSource = apps.get_model("api", "BrainKnowledgeSource")
    BrainKnowledgeSource.objects.filter(
        slug__in=[
            "aquaculture-fcr-benchmark",
            "retail-inventory-turnover",
            "ar-days-outstanding",
            "gross-margin-retail",
            "hr-retention-sme",
        ]
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0160_brain_ai_manager_models"),
    ]

    operations = [
        migrations.RunPython(seed_knowledge, unseed_knowledge),
    ]
