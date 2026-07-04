"""Smart question routing — classify user questions and route to the correct handler."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from api.services.brain.intents import (
    detect_intents,
    is_conversational_turn,
    is_greeting_message,
    wants_advisory_extras,
    wants_benchmark_or_decision_research,
)
from api.services.brain.global_business_gaps import wants_global_gap_analysis, wants_solution_explanation
from api.services.brain.list_requests import detect_list_module

# Question type constants
TYPE_SIMPLE_DATA = "simple_data"
TYPE_ANALYTICAL = "analytical"
TYPE_FORECASTING = "forecasting"
TYPE_ADVISORY = "advisory"
TYPE_EXTERNAL_COMPARE = "external_compare"
TYPE_GAP_ANALYSIS = "gap_analysis"
TYPE_SOLUTION_EXPLAIN = "solution_explain"
TYPE_REPORT = "report"
TYPE_ACTION = "action"
TYPE_RISKY = "risky"
TYPE_CONVERSATIONAL = "conversational"
TYPE_GREETING = "greeting"
TYPE_LIST = "list"

_FORECAST_RE = re.compile(
    r"(forecast|predict|projection|purbabhash|পূর্বাভাস|ভবিষ্য|what\s+may\s+happen|"
    r"continue|চলতে\s+থাক|trend|ট্রেন্ড|outlook|roadmap|রোডম্যাপ)",
    re.I,
)
_COMPARE_RE = re.compile(
    r"(compare|comparison|benchmark|industry|global|world|standard|best\s+practice|"
    r"worldwide|world-wide|other\s+compan|how\s+(they|business)|"
    r"তুলনা|বিশ্ব|গ্লোবাল|standard|outside|external|market\s+average|অন্য\s+কোম্পানি)",
    re.I,
)
_GAP_RE = re.compile(
    r"(gap|gaps|shortage|weakness|weak|behind|lagging|audit|ঘাটতি|গ্যাপ|দুর্বল)",
    re.I,
)
_SOLUTION_RE = re.compile(
    r"(how\s+will|how\s+would|how\s+does|how\s+can|how\s+do|will\s+this\s+solve|"
    r"solve\s+my|solve\s+the\s+problem|why\s+will|why\s+should|explain|reference|"
    r"কিভাবে\s+সমাধান|কীভাবে\s+সমাধান|সমাধান\s+হবে|ব্যাখ্যা\s+কর)",
    re.I,
)
_REPORT_RE = re.compile(
    r"(report|summary|dashboard|overview|full\s+analysis|সারাংশ\s+রিপোর্ট|রিপোর্ট\s+দাও)",
    re.I,
)
_ACTION_RE = re.compile(
    r"(should\s+we|what\s+should|recommend|action|do\s+now|management\s+do|"
    r"পরামর্শ|কি\s+কর|করা\s+উচিত|suggest|execute|approve)",
    re.I,
)
_RISKY_RE = re.compile(
    r"(fire|terminate|lay\s?off|job\s+cut|legal\s+guarantee|medical\s+diagnosis|"
    r"prescription|delete\s+all|wipe|hack|bypass|other\s+tenant|competitor.?s?\s+private|"
    r"চাকরি\s+ছাঁট|বরখাস্ত)",
    re.I,
)


@dataclass(frozen=True)
class QuestionRoute:
    question_type: str
    advisor_mode: str
    use_llm: bool
    model_role: str  # fast | reasoning | research
    include_forecast: bool
    include_external: bool
    include_advisory: bool
    include_global_gaps: bool
    direct_answer_first: bool
    risk_flag: bool


def _detect_advisor_mode(intents: set[str], text: str) -> str:
    t = text.lower()
    if intents & {"hr", "job_cut", "employee"} or re.search(r"(salary|payroll|employee|কর্মচার|বেতন)", t):
        return "hr"
    if intents & {"inventory", "fuel"} or re.search(r"(stock|inventory|স্টক|ইনভেন্টরি)", t):
        return "inventory"
    if intents & {"sales", "sales_today", "customer_ar"} or re.search(r"(sales|customer|বিক্র|গ্রাহক)", t):
        return "sales"
    if intents & {"profit", "expense", "payments"} or re.search(r"(profit|account|ledger|লাভ|হিসাব|খরচ)", t):
        return "accountant"
    if re.search(r"(risk|warning|danger|ঝুঁকি|সতর্ক)", t):
        return "risk"
    if re.search(r"(ceo|executive|board|management\s+summary|ম্যানেজমেন্ট\s+সারাংশ)", t):
        return "ceo"
    return "manager"


def classify_question(text: str, *, intents: list[str] | None = None) -> str:
    """Return question type string."""
    q = (text or "").strip()
    if not q:
        return TYPE_SIMPLE_DATA
    if is_greeting_message(q):
        return TYPE_GREETING
    if detect_list_module(q):
        return TYPE_LIST

    intent_set = set(intents or detect_intents(q))

    if is_conversational_turn(intent_set) and not intent_set - {"chat", "greeting", "help"}:
        return TYPE_CONVERSATIONAL
    if _FORECAST_RE.search(q) or wants_benchmark_or_decision_research(q):
        if _FORECAST_RE.search(q):
            return TYPE_FORECASTING
    if _SOLUTION_RE.search(q) or wants_solution_explanation(q):
        return TYPE_SOLUTION_EXPLAIN
    if _GAP_RE.search(q) or wants_global_gap_analysis(q):
        return TYPE_GAP_ANALYSIS
    if _COMPARE_RE.search(q):
        return TYPE_EXTERNAL_COMPARE
    if _RISKY_RE.search(q):
        return TYPE_RISKY
    if _REPORT_RE.search(q):
        return TYPE_REPORT
    if _ACTION_RE.search(q) or wants_advisory_extras(q):
        return TYPE_ADVISORY
    if intent_set & {"fcr", "density", "profit", "sales", "expense", "customer_ar", "inventory"}:
        if _FORECAST_RE.search(q):
            return TYPE_FORECASTING
        if wants_advisory_extras(q):
            return TYPE_ADVISORY
        return TYPE_ANALYTICAL
    return TYPE_SIMPLE_DATA


def route_question(
    text: str,
    *,
    intents: list[str] | None = None,
    plan: str = "free",
    advisor_mode: str | None = None,
) -> QuestionRoute:
    """Build routing config for chat orchestration."""
    q = (text or "").strip()
    intent_list = intents or detect_intents(q)
    intent_set = set(intent_list)
    qtype = classify_question(q, intents=intent_list)
    mode = advisor_mode or _detect_advisor_mode(intent_set, q)

    if qtype == TYPE_GREETING:
        return QuestionRoute(
            question_type=qtype,
            advisor_mode=mode,
            use_llm=False,
            model_role="fast",
            include_forecast=False,
            include_external=False,
            include_advisory=False,
            include_global_gaps=False,
            direct_answer_first=True,
            risk_flag=False,
        )

    if qtype == TYPE_LIST:
        return QuestionRoute(
            question_type=qtype,
            advisor_mode=mode,
            use_llm=False,
            model_role="fast",
            include_forecast=False,
            include_external=False,
            include_advisory=False,
            include_global_gaps=False,
            direct_answer_first=True,
            risk_flag=False,
        )

    if qtype == TYPE_CONVERSATIONAL:
        return QuestionRoute(
            question_type=qtype,
            advisor_mode=mode,
            use_llm=True,
            model_role="fast",
            include_forecast=False,
            include_external=False,
            include_advisory=False,
            include_global_gaps=False,
            direct_answer_first=False,
            risk_flag=False,
        )

    if qtype == TYPE_RISKY:
        return QuestionRoute(
            question_type=qtype,
            advisor_mode="risk",
            use_llm=True,
            model_role="reasoning",
            include_forecast=False,
            include_external=False,
            include_advisory=True,
            include_global_gaps=False,
            direct_answer_first=True,
            risk_flag=True,
        )

    needs_global = qtype in (
        TYPE_EXTERNAL_COMPARE,
        TYPE_GAP_ANALYSIS,
        TYPE_SOLUTION_EXPLAIN,
        TYPE_ADVISORY,
        TYPE_FORECASTING,
        TYPE_REPORT,
    ) or wants_global_gap_analysis(q) or wants_solution_explanation(q)

    use_research = qtype in (
        TYPE_EXTERNAL_COMPARE,
        TYPE_GAP_ANALYSIS,
        TYPE_SOLUTION_EXPLAIN,
    ) or (needs_global and plan in ("growth", "enterprise"))

    model_role = "research" if use_research else "reasoning"
    if qtype == TYPE_SIMPLE_DATA and not wants_advisory_extras(q) and not needs_global:
        model_role = "reasoning"

    return QuestionRoute(
        question_type=qtype,
        advisor_mode=mode,
        use_llm=True,
        model_role=model_role,
        include_forecast=qtype in (TYPE_FORECASTING, TYPE_ADVISORY, TYPE_REPORT, TYPE_GAP_ANALYSIS),
        include_external=needs_global,
        include_advisory=qtype
        in (TYPE_ADVISORY, TYPE_ACTION, TYPE_FORECASTING, TYPE_REPORT, TYPE_GAP_ANALYSIS, TYPE_SOLUTION_EXPLAIN, TYPE_EXTERNAL_COMPARE)
        or wants_advisory_extras(q)
        or wants_solution_explanation(q),
        include_global_gaps=needs_global,
        direct_answer_first=qtype in (TYPE_SIMPLE_DATA, TYPE_ANALYTICAL) and not wants_solution_explanation(q),
        risk_flag=qtype == TYPE_RISKY,
    )


def route_to_dict(route: QuestionRoute) -> dict[str, Any]:
    return {
        "question_type": route.question_type,
        "advisor_mode": route.advisor_mode,
        "use_llm": route.use_llm,
        "model_role": route.model_role,
        "include_forecast": route.include_forecast,
        "include_external": route.include_external,
        "include_advisory": route.include_advisory,
        "include_global_gaps": route.include_global_gaps,
        "direct_answer_first": route.direct_answer_first,
        "risk_flag": route.risk_flag,
    }
