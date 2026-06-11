# FSERP — Adib Filling Station ও Premium Agro: বাস্তব উদাহরণসহ ব্যবহারকারী নির্দেশিকা (বাংলা)

এই গাইড **একই কোম্পানির** ভিতরে দুটি আলাদা ব্যবসা ও একাধিক **স্বতন্ত্র entity** (সত্তা) কীভাবে FSERP-এ চালাতে হয়, তা **ধাপে ধাপে** বাংলায় ব্যাখ্যা করে।

**ধরে নেওয়া সেটআপ (আপনার প্রতিষ্ঠানের মতো):**

| Entity | ধরন | POS / কাজ |
|--------|------|-----------|
| **Adib Filling Station** | ফিলিং স্টেশন (`operates_fuel_retail = true`) | পেট্রোল/ডিজেল **+** জেনারেল আইটেম (engine oil, shop) |
| **Premium Agro** | অ্যাগ্রো/শপ হাব (`operates_fuel_retail = false`) | ফিড, ঔষধ, সরঞ্জাম — **ফুয়েল নেই** |
| **Nursing Pond** | পুকুর (nursing) | ফ্রাই/আঙুর grow-out-এ যায় |
| **Grow-out Pond 1, 2…** | পুকুর (grow-out) | মাছ বড় হয়, বিক্রয়/হার্ভেস্ট |

**গুরুত্বপূর্ণ:** Adib, Premium Agro, এবং **প্রতিটি পুকুর** আলাদা **P&L, Balance Sheet, Trial Balance** ইত্যাদি রিপোর্টে দেখা যায় — যখন লেনদেন সঠিক **Site / Pond** ট্যাগ দিয়ে পোস্ট হয়।

**সাধারণ গাইড:** `USER_GUIDE_BN.md` (সব মডিউলের তালিকা)  
**এই ফাইল:** Adib + Premium Agro + পুকুর — **ব্যবহারের উদাহরণ**

---

## সূচিপত্র

1. [Entity মডেল — কে কাকে আলাদা](#১-entity-মডেল)
2. [একবারের সেটআপ (Admin)](#২-একবারের-সেটআপ)
3. [Adib Filling Station — দৈনন্দিন কাজ](#৩-adib-filling-station)
4. [Premium Agro — দৈনন্দিন কাজ](#৪-premium-agro)
5. [পুকুর (Nursing ও Grow-out)](#৫-পুকুর-অপারেশন)
6. [Bills — কোথায় খরচ লাগবে](#৬-bills-ও-খরচ-বরাদ্দ)
7. [Journal Entries — Site/Pond ট্যাগ](#৭-journal-entries)
8. [রিপোর্ট — entity অনুযায়ী P&L / BS](#৮-রিপোর্ট)
9. [Reporting Categories ও Chart of Accounts (COA)](#৯-reporting-categories-ও-chart-of-accounts-coa)
10. [মাস শেষ — মালিকের চেকলিস্ট](#১০-মাস-শেষ-চেকলিস্ট)
11. [Backup & Restore — ব্যাকআপ ও পুনরুদ্ধার](#১১-backup--restore)
12. [সাধারণ ভুল ও সমাধান](#১২-সাধারণ-ভুল)

---

## ১. Entity মডেল

### ১.১ তিন ধরনের “সত্তা”

```
┌─────────────────────────────────────────────────────────────┐
│                    আপনার কোম্পানি (Company)                  │
├─────────────────┬─────────────────┬─────────────────────────┤
│ Adib Filling    │ Premium Agro    │ Ponds (পুকুর)           │
│ Station         │ (Shop hub)      │ Nursing, Grow-out 1…    │
│ station_id      │ station_id      │ pond_id (p:1, p:2…)     │
└─────────────────┴─────────────────┴─────────────────────────┘
         │                  │                    │
         └──────────────────┴────────────────────┘
                    GL Journal Lines
              (pratyek P&L line e tag)
```

| Entity | রিপোর্টে Site ফিল্টার | GL-এ ট্যাগ |
|--------|------------------------|------------|
| Adib | Site = **Adib Filling Station** | `station_id` = Adib |
| Premium Agro | Site = **Premium Agro** | `station_id` = Premium Agro |
| Nursing Pond | Site = **Nursing Pond** (`p:…`) | `aquaculture_pond_id` = সেই পুকুর |
| Grow-out Pond 1 | Site = **Grow-out Pond 1** | `aquaculture_pond_id` |

**নিয়ম:** Income / COGS / Expense লাইনে **station** **অথবা** **pond** ট্যাগ থাকলে সেই entity-র P&L-এ যায়। দুটোই খালি থাকলে **Head office / Unscoped** — শুধু কোম্পানি-মোট ও “All Entities” রিপোর্টে দেখা যায়, নir্দিষ্ট স্টেশন/পুকুর P&L-এ নয়।

### ১.২ POS পার্থক্য

| | Adib | Premium Agro |
|---|------|--------------|
| ফুয়েল (লিটার) | ✓ নজল দিয়ে | ✗ (ফুয়েল retail বন্ধ) |
| জেনারেল shop | ✓ | ✓ |
| ফিড / ঔষধ | ✓ (ঐচ্ছিক) | ✓ **মূল কাজ** |
| পুকুর On account | সাধারণ walk-in | **প্রতি পুকুরের গ্রাহক** দিয়ে ফিড/ঔষধ |

---

## ২. একবারের সেটআপ

**কে:** কোম্পানি **Admin / মালিক**  
**কোথায়:** Company, Stations, Aquaculture → Ponds, Users, Chart of Accounts

### ধাপ ২.১ — কোম্পানি

1. **Company** (`/company`) খুলুন।
2. **Station mode:** `multi` (Adib + Premium Agro দুটো active site)।
3. **Aquaculture enabled:** চালু (পুকুর মডিউল)।
4. **Currency / timezone:** BDT, Asia/Dhaka।

### ধাপ ২.২ — স্টেশন

**Stations** (`/stations`) → **Adib Filling Station**

| ফিল্ড | মান |
|--------|-----|
| station_name | Adib Filling Station |
| operates_fuel_retail | ✓ **চালু** (Fuel forecourt) |
| is_active | ✓ |

**Stations** → **Premium Agro**

| ফিল্ড | মান |
|--------|-----|
| station_name | Premium Agro |
| operates_fuel_retail | ✗ **বন্ধ** (Shop / aquaculture hub) |
| default_aquaculture_pond_id | (ঐচ্ছিক) প্রধান পুকুর |
| is_active | ✓ |

**Adib-এর জন্য পরে:** Tanks → Islands → Dispensers → Meters → Nozzles (ফুয়েল লাইন)।

### ধাপ ২.৩ — পুকুর

**Aquaculture → Ponds** (`/aquaculture/ponds`)

**উদাহরণ:**

| পুকুর | pond_role | কাজ |
|--------|-----------|-----|
| Nursing Pond | nursing | ফ্রাই/আঙুর রাখা |
| Grow-out Pond 1 | grow_out | বাজার-size মাছ |
| Grow-out Pond 2 | grow_out | দ্বিতীয় grow-out |

প্রতি পুকুর সেভ করলে সিস্টেম **POS গ্রাহক** (যেমন `Pond Grow-out 1 Customer`) তৈরি করতে পারে — Premium Agro POS-এ On account বিক্রির জন্য।

### ধাপ ২.৪ — পণ্য (Items)

**Products** (`/items`) — উদাহরণ SKU:

| আইটেম | pos_category | কোথায় বিক্রি |
|--------|--------------|---------------|
| Diesel | fuel | Adib POS |
| Octane | fuel | Adib POS |
| Engine oil 1L | general | Adib |
| Feed 25kg | feed | Premium Agro (+ Adib shop থাকলে) |
| Medicine X | medicine | Premium Agro |
| Aerator spare | general / supplies | Premium Agro |

**is_pos_available:** ✓ যেগুলো ক্যাশিয়ারে দেখাতে চান।

### ধাপ ২.৫ — ব্যবহারকারী

**Users** (`/users`) — উদাহরণ:

| কর্মী | Role | home_station | pos_sale_scope |
|--------|------|--------------|----------------|
| রফিক (Adib ক্যাশিয়ার) | Cashier | Adib Filling Station | both বা fuel |
| সুমি (Agro দোকান) | Shopkeeper | Premium Agro | general |
| হিসাবরক্ষী | Accountant | (খালি) | — |
| মালিক | Admin | — | — |

---

## ৩. Adib Filling Station

### ৩.১ সকাল — শিফট খোলা

1. **Shift Management** (`/shift-management`)।
2. **Station:** Adib Filling Station।
3. **Open shift** → opening meter readings (প্রতি নজল)।
4. নগদ drawer opening balance লিখুন (যদি ফর্মে থাকে)।

### ৩.২ দিন — POS বিক্রয়

**Cashier** (`/cashier`) — লগইন: রফিক (home station = Adib)

**উদাহরণ A — ডিজেল (walk-in)**

1. New sale।
2. গ্রাহক: খালি বা “Walk-in Customer”।
3. লাইন: **Diesel** — ৪০ লিটার × ১৩০ = ৫,২০০ টাকা।
4. Payment: **Cash**।
5. Complete → রসিদ।

→ GL: Adib **station_id**-তে fuel revenue / COGS (অটো-পোস্ট)।

**উদাহরণ B — engine oil (shop)**

1. New sale → Engine oil 1L × ২ = ৬০০ টাকা।
2. Payment: Cash।

→ Adib entity-তে shop revenue।

**উদাহরণ C — corporate credit**

1. গ্রাহক: “ABC Transport” (credit customer)।
2. Diesel ২০০ লিটার → **On account (A/R)**।
3. পরে **Payments → Received** দিয়ে আদায়।

### ৩.৩ সন্ধ্যা — শিফট বন্ধ

1. **Shift Management** → Adib → **Close shift**।
2. Closing meter readings → variance (লিটার/নগদ) দেখুন।
3. **Tank Dips** (যদি নীতি হয়) — ট্যাঙ্ক ডিপ রেকর্ড।

### ৩.৪ Adib খরচ (Bills)

**Bills** → Bill purpose: **Station / shop**

| লাইন | Receive at station | উদাহরণ |
|------|-------------------|--------|
| Generator diesel | Adib | ৫,০০০ টাকা |
| Forecourt repair | Adib | Station cost type: Maintenance |
| Office rent (শুধু Adib) | Adib | Operating |

**Fuel station reporting category (ঐচ্ছিক):** “Generator diesel” → Rolls up to **Utilities**।

### ৩.৫ Adib রিপোর্ট (এক entity)

**Reports** (`/reports`):

1. **Site** = **Adib Filling Station** (All নয়)।
2. Period = এই মাস।
3. রিপোর্ট বেছে নিন:

| রিপোর্ট | কী দেখবেন |
|---------|-----------|
| **Profit & Loss** | Adib-র আয়, COGS, খরচ, নিট |
| **Balance Sheet** | Adib-scoped asset/liability (যেখানে tag আছে) |
| **Daily Summary** | শিফট, লিটার, shop |
| **Sales by Nozzle** | কোন নজলে কত |
| **Fuel Sales Analytics** | লিটার ও টাকা |

---

## ৪. Premium Agro

Premium Agro **ফুয়েল POS করে না** — শুধু feed, medicine, equipment, general।

### ৪.১ স্টক আনা (Inventory)

**Inventory & transfers** (`/inventory`)

**উদাহরণ:** সাপ্লায়ার থেকে ১০০ বস্তা ফিড Premium Agro-তে এসেছে।

1. Bill দিয়ে ক্রয় (নিচে §৬) **অথবা** adjustment/transfer।
2. **Inventory** → Premium Agro স্টেশনে on-hand ১০০ বস্তা দেখুন।

**পুকুর warehouse-এ পাঠানো:**

1. **Transfer:** Premium Agro → **Grow-out Pond 1 warehouse** — ২০ বস্তা ফিড।
2. Pond warehouse stock **Aquaculture → Pond detail** বা inventory-তে দেখুন।

### ৪.২ POS — পুকুরে On account বিক্রি

**Cashier** — সুমি, home station = **Premium Agro**, scope = **general**

**উদাহরণ:** Grow-out Pond 1-এ ৫ বস্তা ফিড

1. New sale।
2. **Customer:** `Grow-out Pond 1 Customer` (সিস্টেম-তৈরি পুকুর গ্রাহক)।
3. লাইন: Feed 25kg × ৫ = (দাম অনুযায়ী)।
4. Payment: **শুধু On account (A/R)** — নগদ অপশন পুকুর গ্রাহকে সাধারণত থাকে না।
5. Complete।

→ খরচ/আয় **Grow-out Pond 1** entity-তে P&L-এ যায় (feed bucket); Premium Agro inventory কমে।

**Walk-in retail (কাউন্টারে নগদ):**

1. Customer: Walk-in।
2. Medicine / equipment → **Cash**।
→ **Premium Agro station** P&L (shop revenue)।

### ৪.৩ Premium Agro entity রিপোর্ট

**Reports** → Site = **Premium Agro**

| রিপোর্ট | উদ্দেশ্য |
|---------|----------|
| **Profit & Loss** | Agro shop-এর shop revenue ও খরচ |
| **Item sales by category** | feed / medicine / general |
| **Inventory SKU valuation** | Premium Agro স্টক মূল্য |
| **Daily Summary** (segment Aquaculture shop) | Agro hub দিনের সারাংশ |

**নোট:** পুকুর-On-account বিক্রির P&L **পুকুর entity**-তে বেশি দেখা যায়; Premium Agro P&L-এ shop margin / inventory movement দেখুন।

---

## ৫. পুকুর অপারেশন

### ৫.১ Nursing Pond — ফ্রাই স্টক

**Bills** — Receiving location = **Nursing Pond**

| লাইন | Category | GL | উদাহরণ |
|------|----------|-----|--------|
| Fry purchase | fry_stocking | **6715** + pond tag | ৫,০০,০০০ পিস, ৩,৫০,০০০ টাকা |

**Aquaculture → Pond stock** — Nursing-এ পিস/kg দেখুন।

### ৫.২ Nursing → Grow-out Transfer

**Aquaculture → Pond transfers** (`/aquaculture/transfers`)

**উদাহরণ:**

| ফিল্ড | মান |
|--------|-----|
| From | Nursing Pond |
| To | Grow-out Pond 1 |
| Date | ২০২৬-০৫-১৭ |
| Species | Tilapia |
| Weight | ১,২০০ kg |
| Fish count | ১,২০,০০০ |
| Cost | (অটো — ফ্রাই+ফিড অনুপাত) |

→ Grow-out Pond 1-এ **biological cost** বাড়ে; Nursing stock কমে।

### ৫.৩ Grow-out — ফিড, ঔষধ, খরচ

| কাজ | কোথায় | উদাহরণ |
|-----|--------|--------|
| ফিড warehouse থেকে খাওয়ানো | **Feeding advice** apply | ২ বস্তা consumed |
| ঔষধ | **Medicine** | ১ kg medicine consumed |
| বিদ্যুৎ/মজুরি বিল | **Bills** → Pond line | Grow-out Pond 1, electricity |
| ভাড়া | **Landlords** | lease paid — Pond allocate |

**Pond costs** (`/aquaculture/expenses`) — শুধু legacy/manual; **নতুন খরচ Bills/POS/Landlords দিয়ে** (Add expense অনেক category block)।

### ৫.৪ Grow-out — মাছ বিক্রয়

**Aquaculture → Pond & fish sales** (`/aquaculture/sales`)

**উদাহরণ:**

| ফিল্ড | মান |
|--------|-----|
| Pond | Grow-out Pond 1 |
| income_type | fish_harvest_sale |
| weight_kg | ৮,০০০ |
| fish_count | ৮,০,০০,০০০ |
| total_amount | ২৪,০০,০০০ টাকা |

→ Grow-out Pond 1 entity P&L-এ revenue; stock kg/পিস কমে।

### ৫.৫ পুকুর entity রিপোর্ট

**Reports** → Site = **Grow-out Pond 1** (`p:…` ফরম্যাট)

| রিপোর্ট | কী দেখবেন |
|---------|-----------|
| **Profit & Loss** | ওই পুকুরের আয়−খরচ |
| **aquaculture-pond-pl** | পুকুর P&L বিস্তার |
| **aquaculture-pl-management** | সব পুকুর তুলনা (Site = All বা management report) |
| **Fish stock position** | kg/পিস |

**Nursing Pond**-এর জন্য Site = Nursing Pond — transfer-এর আগ পর্যন্ত fry cost, feed consumed দেখুন।

---

## ৬. Bills ও খরচ বরাদ্দ

### ৬.১ Bill purpose — তিন ধরন

| Purpose | কখন | Receiving location / Site tag |
|---------|------|-------------------------------|
| **Station / shop** | Adib বা Premium Agro খরচ | **Receiving location** → fuel/shop **station** |
| **Pond** | পুকুর খরচ | **Receiving location** → **পুকুর** (অথবা line-এ pond) |
| **Office / shared** | Head office | Receiving location খালি + purpose **Office** |

**Receiving location (station বা pond)** — **Bills** (`/bills`) ফর্মের উপরে:

| বাছাই | স্বয়ংক্রিয় কাজ |
|--------|------------------|
| **Adib Filling Station** | Bill purpose → Station; `station_id` = Adib |
| **Premium Agro** | Bill purpose → Station; shop hub স্টক/পেমেন্ট |
| **Nursing Pond / Grow-out Pond 1…** | Bill purpose → Pond; line-গুলোতে pond pre-fill; shop hub (Premium Agro) পেমেন্ট/স্টকের জন্য অটো |

**গুরুত্বপূর্ণ:** প্রতি পুকুরের জন্য **আলাদা GL account (যেমন “6716 — Pond 1”) তৈরি করবেন না**। সব পুকুর **একই COA কোড** (6716, 4240…) ব্যবহার করে; **কোন পুকুর** তা **pond tag** দিয়ে আলাদা হয় — §৯ দেখুন।

### ৬.২ উদাহরণ — এক বিল, দুই সাইট (Shared)

সাপ্লায়ার: “National Feed Co” — ৫০,০০০ টাকা — Adib ২০,০০০ + Premium Agro ৩০,০০০

1. Bill → line → **Shared — manual** station shares।
2. Adib: ২০,০০০, Premium Agro: ৩০,০০০।

### ৬.৩ উদাহরণ — Grow-out Pond 1 electricity

1. **Bills** → Vendor: বিদ্যুৎ সাপ্লায়ার।
2. **Receiving location:** **Grow-out Pond 1** (dropdown-এ pond গ্রুপ)।
3. Bill purpose স্বয়ংক্রিয় **Pond** হবে।
4. Line: Electricity ১২,০০০ টাকা।
5. **Expense category:** electricity → GL **6717** (pond tag = Grow-out Pond 1)।

→ শুধু **Grow-out Pond 1** P&L-এ electricity; Premium Agro shop P&L-এ যাবে **না** (pond-tagged line station receipt থাকলেও)।

### ৬.৩ক — Grow-out Pond 1 ফিড ক্রয় (vendor bill)

1. **Receiving location:** **Grow-out Pond 1**।
2. Line: Feed 25kg × ২০ বস্তা = (মোট)।
3. Category: **feed_purchase** → GL **6716** + pond tag।

**অথবা** ফিড আগে Premium Agro warehouse-এ এলে **Inventory transfer** → pond warehouse; **Feeding advice apply** দিয়ে consumed — operational register; GL path আলাদা হতে পারে (inventory relief)।

### ৬.৪ Adib generator diesel (station)

1. **Receiving location:** **Adib Filling Station**।
2. Bill purpose: **Station**।
3. Expense + **Fuel station category:** utilities → GL **6100** (station P&L bucket)।

---

## ৭. Journal Entries

**Journal Entries** (`/journal-entries`) — ম্যানুয়াল GL

**নিয়ম (পোস্ট করার আগে):** Income / COGS / Expense লাইনে **Site (station)** বা **Pond** বাছতে হবে — নাহলে post block বা Head office-তে যাবে।

**উদাহরণ — Adib bank charge ৫০০ টাকা**

| Account | Debit | Credit | Site |
|---------|-------|--------|------|
| Bank charges expense | ৫০০ | | **Adib Filling Station** |
| Bank account | | ৫০০ | (balance sheet — site optional) |

**উদাহরণ — Grow-out Pond 1 miscellaneous ২,০০০**

| Account | Debit | Credit | Pond |
|---------|-------|--------|------|
| Aquaculture expense — other | ২,০০০ | | **Grow-out Pond 1** |
| Cash | | ২,০০০ | |

---

## ৮. রিপোর্ট

### ৮.১ Site ফিল্টার (সব financial report-এ)

**Reports** (`/reports`) উপরে:

| Site বাছাই | ফলাফল |
|------------|--------|
| **All sites** | কোম্পানি-মোট বা entity summary |
| **Adib Filling Station** | শুধু Adib entity |
| **Premium Agro** | শুধু Premium Agro entity |
| **Nursing Pond** (`p:…`) | শুধু সেই পুকুর |
| **Grow-out Pond 1** | শুধু সেই পুকুর |

### ৮.২ Entity summary — এক নজরে সব

| রিপোর্ট ID | বাংলা | কাজ |
|------------|-------|-----|
| **entities-pl-summary** | সব entity — P&L | Adib, Premium Agro, প্রতিটি pond, Unscoped এক টেবিল |
| **entities-balance-sheet-summary** | সব entity — BS | |
| **entities-trial-balance-summary** | সব entity — TB | |
| **entities-financial-summary** | সম্মিলিত financial | |
| **stations-financial-summary** | সব স্টেশন P&L | Adib vs Premium Agro |
| **ponds-pl-summary** | সব পুকুর P&L | Nursing vs Grow-out |

**উদাহরণ — মালিক মাস শেষ:**

1. Reports → Period: জুন ২০২৬।
2. Site: **All**।
3. **entities-pl-summary** খুলুন।
4. সারি দেখুন:

| Entity | Net income (উদাহরণ) |
|--------|---------------------|
| Adib Filling Station | +১,২০,০০০ |
| Premium Agro | +৪৫,০০০ |
| Nursing Pond | −৮০,০০০ (investment phase) |
| Grow-out Pond 1 | +৩৫,০০০ |
| Grow-out Pond 2 | +২৮,০০০ |
| Head office / Unscoped | −১০,০০০ |

5. একটি entity drill-down: Site = **Grow-out Pond 1** → **income-statement**।

### ৮.৩ Business segment (Daily Summary)

**Daily Summary**-এ **Fuel** vs **Aquaculture (Premium Agro)** segment — এক দিনে forecourt vs agro shop তুলনা।

### ৮.৪ Analytics KPI

**Reports** → **Analytics & KPIs** → Site = Adib বা Premium Agro বা pond → চার্টে sales, COGS, expenses।

---

## ৯. Reporting Categories ও Chart of Accounts (COA)

### ৯.১ মূল নীতি — এক COA, পুকুর = dimension (ট্যাগ)

| স্তর | কাজ | উদাহরণ |
|------|-----|--------|
| **COA (account code)** | খরচ/আয়ের **ধরন** — সব পুকুর **একই** | 6716 = ফিড, 4240 = হার্ভেস্ট বিক্রয় |
| **Pond tag** | **কোন পুকুর** | Nursing Pond, Grow-out Pond 1 |
| **Expense category / income_type** | অপারেশনাল শ্রেণি → COA map | electricity → 6717 |
| **Reporting category** | কাস্টম লেবেল → built-in rollup | “Pond watchman” → other → 6725 |

```
ভুল:  “6716 Feed — Grow-out Pond 1”  (প্রতি পুকুর আলাদা account)
ঠিক:  Dr 6716 Feed  +  pond tag = Grow-out Pond 1
```

**কেন:** ১৫+ category × ১০ পুকুর = শতাধিক account — maintain করা কঠিন, entity তুলনা কঠিন, Bills/POS/JE logic duplicate হয়। FSERP **professional ERP** নিয়ম অনুযায়ী **dimension tagging** ব্যবহার করে (fuel station-ও একই: 4100 + `station_id`, “4100 — Adib” account নয়)।

**Chart of Accounts** (`/chart-of-accounts`) — aquaculture enable করলে **424x / 671x / 1580 / 1581 / 3190 / 6726** স্বয়ংক্রিয় seed হয়।

---

### ৯.২ পুকুর আয় — COA 4240–4244

| income_type (Aquaculture → Sales) | GL কোড | বাংলা / কাজ |
|-----------------------------------|--------|-------------|
| fish_harvest_sale | **4240** | টেবিল সাইজ / হার্ভেস্ট মাছ বিক্রয় |
| fingerling_sale | **4241** | ফ্রাই / fingerling বিক্রয় |
| processing_value_add | **4242** | প্রসেসিং / value-add |
| other_income | **4243** | অন্যান্য পুকুর আয় |
| empty_feed_sack_sale, used_material_sale, … | **4244** | খালি বস্তা / scrap (non-biological) |

**উদাহরণ — Grow-out Pond 1 হার্ভেস্ট ২৪,০০,০০০ টাকা**

| ধাপ | কোথায় | GL / tag |
|-----|--------|----------|
| 1 | **Aquaculture → Pond & fish sales** | income_type = fish_harvest_sale |
| 2 | Pond = Grow-out Pond 1 | Revenue **4240** + **pond tag** |
| 3 | Reports → Site = Grow-out Pond 1 | P&L-এ revenue দেখুন |

POS/Invoice দিয়ে shop walk-in revenue **4240 নয়** — shop **4200** (Premium Agro **station** P&L)। পুকুর On-account ফিড বিক্রি pond entity-তে feed bucket-এ যায় (operational + GL path §৪.২)।

---

### ৯.৩ পুকুর খরচ — COA 6711–6726

| expense_category (Bill / Landlords) | GL কোড | বাংলা |
|-------------------------------------|--------|-------|
| lease | **6711** | পুকুর ভাড়া / lease rights |
| worker_salary | **6712** | পুকুর শ্রমিক / মজুরি |
| soilcut | **6713** | মাটি কাটা / earthworks |
| pond_preparation | **6714** | পুকুর প্রস্তুত (liming, drying) |
| fry_stocking | **6715** | ফ্রাই / fingerling ক্রয় |
| feed_purchase, feed_consumed | **6716** | ফিড |
| electricity | **6717** | বিদ্যুৎ (aerator) |
| equipment, repair_maintenance | **6718** | সরঞ্জাম / মেরামত (capitalize না হলে) |
| fisherman | **6719** | মাছ তোলার / fisherman charge |
| transportation | **6720** | পরিবহন |
| medicine_purchase, medicine_consumed | **6721** | ঔষধ / veterinary |
| other, vendor_bill_pond | **6725** | বিবিধ (watchman, nets, …) |
| *(mortality register)* | **6726** | মৃত্যু / predation / shrinkage (Dr 6726 / Cr **1581**) |

**Biological asset:** live fish biomass → **1581** (inventory asset); mortality-তে **6726** expense + **1581** কমে।

**Capital equipment (aerator, pump — fixed asset policy):** capitalize → **1580** + **Fixed Assets** মডিউল; monthly **6320** depreciation (pond/station tag অনুযায়ী)।

---

### ৯.৪ সাধারণ লেনদেন — “কোথায় ক্লিক, কোন account”

#### ক) পুকুর ভাড়া (lease)

| | |
|--|--|
| **কোথায়** | **Landlords** → lease paid **অথবা** Bills |
| **Receiving location** | সেই **পুকুর** |
| **Category** | lease |
| **GL** | Dr **6711** + pond tag; Cr AP/Cash |
| **P&L** | Site = সেই pond → expense |

#### খ) ফিড vendor bill (Grow-out Pond 1)

| | |
|--|--|
| **কোথায়** | **Bills** |
| **Receiving location** | **Grow-out Pond 1** |
| **Line** | Feed item বা expense; category **feed_purchase** |
| **GL** | Dr **6716** + pond tag |
| **সতর্ক** | Receipt station = Premium Agro (shop hub) হতে পারে — **station P&L-এ খরচ যাবে না** যখন pond tag আছে |

#### গ) Nursing-এ fry ক্রয়

| | |
|--|--|
| **Bills** | Receiving location = **Nursing Pond** |
| **Category** | fry_stocking |
| **GL** | Dr **6715** + pond tag |
| **Stock** | fish item line → pond stock (1581 / register) |

#### ঘ) হার্ভেস্ট বিক্রয়

| | |
|--|--|
| **Aquaculture → Sales** | income_type fish_harvest_sale |
| **GL** | Cr **4240** + pond tag; stock/biomass relief |
| **Report** | Site = Grow-out Pond 1 → income-statement |

#### ঙ) মৃত্যু / predation (mortality)

| | |
|--|--|
| **Aquaculture → Fish stock ledger** (loss) | loss_reason mortality / predation |
| **GL (post to books)** | Dr **6726** / Cr **1581** + pond tag |
| **P&L** | Site = pond → mortality expense |

#### চ) Adib / Premium Agro (পুকুর নয়)

| Entity | Typical expense GL | Tag |
|--------|-------------------|-----|
| Adib station bill | **6100** utilities, **6300** maintenance, **6920** operating | `station_id` = Adib |
| Premium Agro shop | **6920** operating, **5120** shop COGS | `station_id` = Premium Agro |
| Head office | **6900** office admin only (সাধারণ stationery) | Unscoped |

**6900** = শুধু office supplies — universal expense **নয়**। স্টেশন bill default **6920** (station operating)।

---

### ৯.৫ Reporting Categories (`/reporting-categories`)

Custom label **COA replace করে না** — **rollup bucket**-এ যায়; built-in code (671x) posting-এ ব্যবহৃত হয়।

| Site বাছাই | Application | উদাহরণ custom label |
|------------|-------------|---------------------|
| Adib Filling Station | fuel_station | “Forecourt security” → Operating → **6920** |
| Premium Agro | aquaculture (shop hub) | “Shop display racks” → Other → **6725** (pond line হলে pond P&L) |
| Grow-out Pond 1 | aquaculture | “Pond watchman” → Other → **6725** + pond tag |

**Rolls up to** ড্রপডাউন + COA hint দেখুন — ভুল bucket = ভুল P&L bucket (account code ঠিক থাকলেও reporting group ভুল হতে পারে)।

**Fuel station expense rollup → COA (Adib bills) — বিস্তারিত তালিকা:**

| Built-in rollup | GL | উদাহরণ |
|-----------------|-----|--------|
| payroll | 6400 | স্টাফ বেতন |
| rent | 6200 | সাইট লিজ |
| insurance | 6500 | বীমা |
| bank_charges | 6600 | কার্ড / ব্যাংক ফি |
| marketing | 6700 | বিজ্ঞাপন |
| security | 7000 | সিকিউরিটি, CIT |
| office_supplies | 6900 | শুধু অফিস স্টেশনারি |
| operating | 6920 | সাধারণ স্টেশন খরচ (ডিফল্ট) |
| utilities | 6100 | বিদ্যুৎ, জেনারেটর |
| water_sewer | 6110 | পানি |
| maintenance | 6300 | পাম্প / ফোরকোর্ট |
| building_maintenance | 6310 | ক্যানোপি / বিল্ডিং |
| cost_of_sales | 5200 | ফুয়েল শ্রিংক |
| shop_shrink | 5210 | শপ ইনভেন্টরি শ্রিংক |
| shop_cogs | 5120 | শপ COGS |
| other | 6990 | অন্যান্য |

**Aquaculture expense rollup (pond bills) — নতুন/গুরুত্বপূর্ণ:**

| Built-in rollup | GL | মন্তব্য |
|-----------------|-----|---------|
| shop_supplies | 6725 | শপ থেকে পুকুরে সরবরাহ |
| mortality | 6726 | মৃত্যু/শিকারি সম্পর্কিত নগদ খরচ |
| repair_maintenance | 6722 | মেরামত (equipment আলাদা → 6718) |

---

### ৯.৬ Entity reporting — Adib, Premium Agro, প্রতি pond

এক কোম্পানি, এক COA; **profit center** = `Station` + `AquaculturePond`। GL লাইনে `station_id` বা `aquaculture_pond_id` ট্যাগ থাকলে entity P&L হয়।

| Entity | কীভাবে চেনবেন | মূল রিপোর্ট |
|--------|----------------|-------------|
| **Adib Filling Station** | `operates_fuel_retail = true` | Reports → Site = Adib → P&L; **All Stations — P&L** |
| **Premium Agro** | Shop hub (`operates_fuel_retail = false`) | **All Entities — P&L** → `combined_shop_gross_profit` দেখুন (POS থেকে pond-এ বিক্রি সহ) |
| **প্রতি pond** | `AquaculturePond` | Site = `p:{id}` → P&L; **All Ponds — P&L Summary** |

**গুরুত্বপূর্ণ নিয়ম:** pond ট্যাগ থাকলে সেই আয়/খরচ **pond P&L**-এ যায় — Premium Agro স্টেশন row-এ সরাসরি দেখা নাও যেতে পারে; **combined_shop_*** কলাম পুরো শপ কার্যক্রম দেখায়।

| প্রয়োজন | রিপোর্ট | Site scope |
|----------|---------|------------|
| সব entity একসাথে P&L | **All Entities — P&L** | All |
| Pond A/R (feed on account) | **AR Aging** | pond |
| Pond A/P (pond-tagged bills) | **AP Aging** | pond |
| শপ স্টক (Premium Agro) | aquaculture-shop-station-stock | station |
| পুকুর ওয়্যারহাউস স্টক | aquaculture-pond-total-inventory | pond |

**Head office:** station/pond ট্যাগ নেই — **All Entities — P&L**-এ “Head office / unassigned” সারি।

---

### ৯.৭ দ্রুত COA চেকলিস্ট (হিসাবরক্ষী)

- [ ] নতুন পুকুর = **নতুন COA account নয়** — Ponds-এ পুকুর তৈরি + Bills-এ **Receiving location** বাছুন
- [ ] Bill-এ pond line → category (671x) + pond tag দুটোই আছে?
- [ ] Harvest sale → **4240** + সঠিক pond?
- [ ] Mortality → **6726** / **1581**, lease → **6711**?
- [ ] Report Site = **p:…** দিয়ে pond P&L verify; **entities-pl-summary**-এ সব pond একসাথে
- [ ] Premium Agro → **combined_shop_gross_profit** (শুধু station row নয়)
- [ ] Pond AR/AP → Site = pond + **AR/AP Aging**
- [ ] Adib bill **6900** দিয়ে ভরছে না তো? → **security** / **operating** (6920) check

---

## ১০. মাস শেষ চেকলিস্ট (মালিক)

### Adib

- [ ] সব শিফট closed?
- [ ] Tank dips / variance acceptable?
- [ ] Reports → Site Adib → P&L + fuel sales
- [ ] Customer AR aging — corporate fuel credit
- [ ] Bank deposit (Payments → Deposits) matched?

### Premium Agro

- [ ] **All Entities — P&L** → combined shop gross vs direct station row
- [ ] Shop station stock report (feed/medicine on hand)
- [ ] Site Premium Agro → item sales by category
- [ ] Transfers to pond warehouses documented?

### Ponds

- [ ] প্রতি pond → aquaculture-pond-pl বা Site=p: → P&L
- [ ] Transfers Nursing → Grow-out costs sensible?
- [ ] Fish stock position vs sales

### কোম্পানি মোট

- [ ] **Fixed Assets** → **Batch depreciate** (month-end depreciation for all active assets)
- [ ] **entities-pl-summary** — সব entity একসাথে
- [ ] **Trial balance** (company) balanced?
- [ ] **Backup** — §১১ অনুযায়ী মাস শেষ JSON ব্যাকআপ ডাউনলোড + নিরাপদ স্থানে রাখুন

---

## ১১. Backup & Restore

**কোথায়:** **Management → Backup & Restore** (`/backup`)  
**কে:** কোম্পানি **Admin** বা Role-এ **`app.backup`** permission  
**Super Admin:** যেকোনো tenant-এ `/admin/backup`

### ১১.১ এটা কী cover করে (এক tenant = Adib + Premium Agro + সব pond)

| অন্তর্ভুক্ত (schema v2) | বাদ |
|--------------------------|-----|
| Chart of Accounts, journals, bills, invoices, payments | Password reset tokens (নিরাপত্তা) |
| Adib + Premium Agro stations, tanks, shifts, POS history | Backup activity audit log (compliance — restore পুরনো audit মুছে দেয় না) |
| সব pond, cycles, transfers, sales, mortality, Data Bank closes | |
| Inventory (shop + pond warehouse), fixed assets, loans, payroll | |
| Users, roles, reporting categories, organization (login routing) | |

**গুরুত্বপূর্ণ:** এটি **পুরো কোম্পানির ERP ডেটা** — entity tag (station/pond) সহ GL লাইনও backup-এ থাকে। **PostgreSQL / সারвер ডাটাবেস dump**-এর **substitute নয়** — production-এ **দুটোই** রাখুন (অ্যাপ JSON + DB/host backup)।

### ১১.২ Download backup (ব্যাকআপ)

1. `/backup` খুলুন (header-এ সঠিক company selected থাকলে verify করুন)।
2. **Download backup** — `fserp_company_{id}_backup.json` (schema **v2**)।
3. বড় tenant-এ কয়েক মিনিট লাগতে পারে; ব্রাউজার tab বন্ধ করবেন না।
4. ফাইল **নিরাপদ স্থানে** রাখুন: encrypted drive, off-site copy, তারিখ নামে (যেমন `backup_2026-06-10_premium_agro.json`)।

**Export fail হলে:** কোনো company table-এ data আছে কিন্তু bundle-এ যায়নি — support/upgrade লাগতে পারে; backup incomplete নেওয়া যায় না (by design)।

### ১১.৩ Restore (পুনরুদ্ধার) — শুধু জরুরি

Restore = **বর্তমান tenant-এর সব ERP ডেটা মুছে** backup file থেকে **পূর্ণ প্রতিস্থাপন**।

| ধাপ | কাজ |
|-----|-----|
| 1 | **আগে** fresh backup নিন (ভুল file restore হলে ফিরে আসার জন্য) |
| 2 | Type exactly: **`DELETE_ALL_TENANT_DATA`** |
| 3 | Backup file বেছে নিন — **company ID অবশ্যই match** (same tenant) |
| 4 | Browser confirm → restore চলাকালীন tab বন্ধ করবেন না |
| 5 | শেষে page reload / re-login |

**সতর্ক:**

- Production-এ restore **মাস শেষ reconcile-এর পর** বা **staging test** ছাড়া avoid করুন।
- v1 পুরনো backup restore হয়, কিন্তু aquaculture/stock module **অনুপস্থিত** থাকতে পারে — warning দেখুন।
- Server-এ `TENANT_SAFETY_BACKUP_DIR` configured থাকলে restore-এর **আগে** server-side safety snapshot save হতে পারে (Activity history-তে “Safety snapshot saved”)।

### ১১.৪ Activity history (audit)

Backup & Restore পেজের নিচে **Activity history** — কে, কখন, backup/restore, success/fail, record count। Month-end compliance ও “restore drill” log হিসেবে ব্যবহার করুন।

### ১১.৫ পেশাদারি নীতি (Premium Agro + Adib)

| কখন backup | কেন |
|------------|-----|
| **মাস শেষ** (§১০ checklist) | Month-end rollback point |
| Major upgrade / migration-এর **আগে** | Rollback if deploy fails |
| Bulk import, mass delete, restore test-এর **আগে** | Safety net |
| Year-end / auditor request | Off-site archive |

| কখন restore | কেন |
|-------------|-----|
| Staging environment (copy of backup) | **Restore drill** — quarterly recommended |
| Catastrophic data corruption (verified) | Last good backup only |
| Wrong company file | **Never** — ID mismatch block |

**Restore drill (recommended):** staging-এ backup restore → Trial balance balanced? → Adib Site P&L + এক pond P&L spot-check → তারপর production-এ শুধু download রাখুন।

### ১১.৬ কী backup **cover করে না**

- SaaS platform-wide multi-tenant DB (Super Admin → host PostgreSQL backup)
- Uploaded files/media (যদি আলাদা storage থাকে)
- Other companies in same FSERP install (প্রতি tenant আলাদা file)

---

## ১২. সাধারণ ভুল

| ভুল | লক্ষণ | সমাধান |
|-----|--------|---------|
| Site ট্যাগ ছাড়া JE post | Entity P&L খালি / Head office-তে সব | JE-তে Site/Pond দিন |
| Premium Agro-তে fuel POS | Fuel option নেই / block | Adib station-এ fuel বিক্রি |
| পুকুর ফিড নগদ POS | P&L ভুল entity | Pond Customer + **On account** |
| Bill pond line without pond / category | খরচ company-wide বা ভুল bucket | **Receiving location** = pond + category (671x) |
| প্রতি পুকুর আলাদা COA account তৈরি | COA ফুলে যায়, compare কঠিন | **671x + pond tag** — §৯.১ |
| Report Site = All দিয়ে এক pond ধরে নেওয়া | সংখ্যা mixed | Site = নির্দিষ্ট pond/station |
| Restore without fresh backup first | Wrong file = data loss | Always download **current** backup before restore |
| Restore production for “testing” | Live data wiped | Use staging + restore drill (§১১.৫) |
| Only app JSON, no DB backup | Server crash = total loss | PostgreSQL/host backup + `/backup` JSON |
| Wrong company backup file | Restore rejected or disaster | Check `company_id` in filename / metadata |

---

## দ্রুত রেফারেন্স — “কোথায় কী করব”

| আমি চাই… | যান… |
|----------|------|
| Adib-এ ডিজেল বিক্রি | Cashier (home=Adib) |
| Agro থেকে pond-এ ফিড transfer | Inventory |
| Pond-এ On account ফিড | Cashier (home=Premium Agro) + Pond Customer |
| Fry কিনেছি | Bills → Receiving location = **Nursing Pond**, category fry_stocking → **6715** |
| পুকুর বিদ্যুৎ বিল | Bills → Receiving location = pond, category electricity → **6717** |
| COA / pond mapping | এই গাইড §৯; `/reporting-categories` |
| Backup / restore | `/backup` — §১১; permission `app.backup` |
| মাছ Grow-out-এ পাঠাব | Aquaculture → Transfers |
| মাছ বিক্রি | Aquaculture → Sales |
| Adib P&L | Reports, Site=Adib, income-statement |
| Grow-out Pond 1 P&L | Reports, Site=Grow-out Pond 1 |
| স্টেশন/পুকুরে equipment capitalize | Fixed Assets (`/fixed-assets`) | Station বা Pond ট্যাগ + place in service |
| মাস শেষ depreciation | Fixed Assets → Batch depreciate | Dr 6320 / Cr 1550 (entity P&L) |
| ম্যানেজার মোটরসাইকেল (সব site/pond) | Fixed Assets → **Head office / shared** | Depreciation শুধু company-wide P&L; Adib/Premium Agro/pond P&L-এ যাবে না |

---

*নথি: Adib Filling Station + Premium Agro + Nursing/Grow-out ponds — FSERP entity-scoped operations, shared aquaculture COA (424x/671x) + pond dimension, বাংলা, ২০২৬।*
