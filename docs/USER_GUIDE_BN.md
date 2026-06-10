# FSERP — কোম্পানি মালিকের সম্পূর্ণ ব্যবহারকারী নির্দেশিকা (বাংলা)

এই নির্দেশিকা **FSERP (Fuel Station ERP)** সফটওয়্যারের **প্রতিটি মডিউল, প্রতিটি মেনু, প্রতিটি গুরুত্বপূর্ণ অপশন** ধাপে ধাপে বাংলায় ব্যাখ্যা করে। উদাহরণে **ফিলিং স্টেশন (যেমন Adib Filling Station)**, **অ্যাগ্রো/শপ হাব (Premium Agro)**, এবং **মাছ চাষের পুকুর** একসাথে চালানোর কথা ধরে নেওয়া হয়েছে।

**কার জন্য:** কোম্পানির **মালিক / Admin**, যিনি সেটআপ, ব্যবহারকারী, হিসাব, অপারেশন ও রিপোর্ট দেখেন।

**সংস্করণ:** ২০২৬ — অ্যাপ মেনু (`erpAppMenu.tsx`) ও রুট অনুযায়ী।

> **Adib Filling Station + Premium Agro + পুকুর (entity P&L সহ):**  
> [`USER_GUIDE_ADIB_PREMIUM_AGRO_BN.md`](USER_GUIDE_ADIB_PREMIUM_AGRO_BN.md)

> **দ্রুত শুরু:** নতুন প্রতিষ্ঠান হলে → [§৪ কোম্পানি সেটআপ](#৪-কোম্পানি-স্টেশন-ও-ফরম্যাট) → [§৭ স্টেশন সেটআপ](#৭-স্টেশন-ম্যানেজমেন্ট) → [§৬ POS](#৬-মূল-মেনু-main) → [§১৭ দৈনিক ওয়ার্কফ্লো](#১৭-সাধারণ-ওয়ার্কফ্লো)।

---

## সূচিপত্র

0. [কোম্পানি মালিক কী কী করতে পারেন](#০-কোম্পানি-মালিক-কী-কী-করতে-পারেন)
1. [এটি কী ও কার জন্য](#১-এটি-কী-ও-কার-জন্য)
2. [শুরু করার আগে](#২-শুরু করার-আগে)
3. [প্রবেশ ও নিরাপত্তা](#৩-প্রবেশ-ও-নিরাপত্তা)
4. [কোম্পানি, স্টেশন ও ফরম্যাট](#৪-কোম্পানি-স্টেশন-ও-ফরম্যাট)
5. [ভূমিকা ও অনুমতি](#৫-ভূমিকা-ও-অনুমতি)
6. [মূল মেনু (Main)](#৬-মূল-মেনু-main)
7. [স্টেশন ম্যানেজমেন্ট](#৭-স্টেশন-ম্যানেজমেন্ট)
8. [অপারেশনস](#৮-অপারেশনস)
9. [অ্যাকাউন্টিং](#৯-অ্যাকাউন্টিং)
10. [বিক্রয়, গ্রাহক ও সরবরাহকারী](#১০-বিক্রয়-গ্রাহক-ও-সরবরাহকারী)
11. [পণ্য ও ইনভেন্টরি](#১১-পণ্য-ও-ইনভেন্টরি)
12. [HR ও পে-রোল](#১২-hr-ও-পে-রোল)
13. [ম্যানেজমেন্ট ও সেটিংস](#১৩-ম্যানেজমেন্ট-ও-সেটিংস)
14. [রিপোর্ট ও অ্যানালিটিক্স](#১৪-রিপোর্ট-ও-অ্যানালিটিক্স)
15. [অ্যাকোয়াকালচার (মাছ চাষ) — সম্পূর্ণ মডিউল](#১৫-অ্যাকোয়াকালচার-মাছ-চাষ--সম্পূর্ণ-মডিউল)
16. [SaaS / প্ল্যাটফর্ম সুপার অ্যাডমিন](#১৬-saas--প্ল্যাটফর্ম-সুপার-অ্যাডমিন)
17. [সাধারণ ওয়ার্কফ্লো](#১৭-সাধারণ-ওয়ার্কফ্লো)
18. [ব্যাকআপ ও রিস্টোর](#১৮-ব্যাকআপ-ও-রিস্টোর)
19. [মুছে ফেলা ও সম্পাদনা](#১৯-মুছে-ফেলা-ও-সম্পাদনা)
20. [সমস্যা সমাধান](#২০-সমস্যা-সমাধান)
21. [শব্দকোষ](#২১-শব্দকোষ)
22. [মডিউল তালিকা (দ্রুত রেফারেন্স)](#২২-মডিউল-তালিকা-দ্রুত-রেফারেন্স)

---

## ০. কোম্পানি মালিক কী কী করতে পারেন

**Admin (কোম্পানি মালিক)** হিসেবে আপনি সাধারণত:

| কাজ | কোথায় |
|-----|--------|
| প্রতিষ্ঠানের নাম, ঠিকানা, মুদ্রা, সময় অঞ্চল | **Company** (`/company`) |
| ফিলিং স্টেশন + শপ হাব + পুকুর সেটআপ | **Stations**, **Aquaculture → Ponds** |
| কর্মী অ্যাকাউন্ট ও অনুমতি | **Users**, **Roles & access** |
| দৈনিক বিক্রয় (POS), শিফট, ট্যাঙ্ক ডিপ | **Cashier**, **Shift Management**, **Tank Dips** |
| হিসাব (COA, জার্নাল, বিল, পেমেন্ট) | **Accounting** ও **Sales** মেনু |
| কাস্টম খরচ/আয়ের নাম (রিপোর্টিং) | **Reporting categories** |
| সব রিপোর্ট ও P&L | **Reports** |
| কোম্পানির ব্যাকআপ | **Backup & Restore** |

**আপনি করতে পারবেন না (Super Admin এর কাজ):** অন্য কোম্পানির ডেটা, প্ল্যাটফর্ম বিলিং, গ্লোবাল ব্যবহারকারী — এগুলো `/admin/*` এ।

---

## ১. এটি কী ও কার জন্য

**FSERP** একটি **Filling Station ERP** — পেট্রোল পাম্প/স্টেশনের দৈনন্দিন কাজ এক প্ল্যাটফর্মে:

- স্টেশন সেটআপ (ট্যাঙ্ক, নজল, মিটার)
- শিফট ও ট্যাঙ্ক ডিপ
- POS / ক্যাশিয়ার বিক্রয়
- ইনভয়েস, বিল, পেমেন্ট, লেজার
- চার্ট অফ অ্যাকাউন্টস ও জার্নাল
- পণ্য ও স্টক
- কর্মী ও পে-রোল
- রিপোর্ট
- (ঐচ্ছিক) মাছ চাষের পুকুর, খরচ, বিক্রয় ও P&L

| ভূমিকা | কাজ |
|--------|-----|
| **Super Admin** | একাধিক কোম্পানি (SaaS), প্ল্যাটফর্ম ব্যাকআপ |
| **Admin** | টেন্যান্টের সব মডিউল, ব্যবহারকারী, ব্যাকআপ |
| **Accountant** | হিসাব, বিক্রয়, বিল; সাধারণত স্টেশন হার্ডওয়্যার মেনু সীমিত |
| **Cashier** | POS, গ্রাহক, কিছু রিপোর্ট |
| **Operator** | মূলত POS (সীমিত) |

---

## ২. শুরু করার আগে

1. আধুনিক ব্রাউজার (Chrome, Edge, Firefox)।
2. প্রতিষ্ঠানের **URL** (যেমন `https://…`)।
3. **ব্যবহারকারী নাম** ও **পাসওয়ার্ড** (অ্যাডমিন দেবে)।
4. একাধিক কোম্পানি থাকলে **কোম্পানি সুইচার** দিয়ে সঠিক প্রতিষ্ঠান বেছে নিন।
5. API সার্ভার চালু ও নেটওয়ার্ক সংযোগ প্রয়োজন।

---

## ৩. প্রবেশ ও নিরাপত্তা

| পেজ | পথ | কাজ |
|-----|-----|-----|
| **হোম** | `/` | লগইন থাকলে অ্যাপসে, না থাকলে লগইনে |
| **লগইন** | `/login` | ব্যবহারকারী নাম + পাসওয়ার্ড |
| **পাসওয়ার্ড ভুলে গেলে** | `/forgot-password` | ইমেইল/ব্যবহারকারী নাম দিয়ে রিসেট লিঙ্ক বা কোড |
| **রিসেট** | `/reset-password` | নতুন পাসওয়ার্ড সেট |
| **আমার পাসওয়ার্ড** | `/account/password` | লগইন থাকা অবস্থায় নিজের পাসওয়ার্ড বদল |

### ৩.১ লগইন ধাপ

1. সাইট খুলুন → **লগইন**।
2. ব্যবহারকারী নাম ও পাসওয়ার্ড দিন → **লগইন**।
3. সাধারণত **অ্যাপস** (`/apps`) বা **ড্যাশবোর্ড** (`/dashboard`) এ যাবেন।

### ৩.২ পাসওয়ার্ড রিসেট

- **Forgot password** এ যে ইমেইল/নাম লগইনে ব্যবহার করেন সেটাই দিন।
- ইমেইলে **লিঙ্ক** বা **৬ সংখ্যার কোড** — সার্ভারে SMTP সেটআপ লাগতে পারে।
- প্রোডাকশনে মেইল না এলে অ্যাডমিনকে জানান।

### ৩.৩ লগআউট

- সাইডবার/প্রোফাইল মেনু থেকে **লগআউট**।

---

## ৪. কোম্পানি, স্টেশন ও ফরম্যাট

### ৪.১ কোম্পানি সুইচার

- UI তে **কোম্পানি পরিবর্তন** করলে সব তালিকা, রিপোর্ট ও লেনদেন **সেই কোম্পানির** ডেটা দেখায়।
- ভুল কোম্পানি বাছাই = খালি তালিকা বা ভুল সংখ্যা।

### ৪.২ স্টেশন ফিল্টার

- কিছু রিপোর্ট/মাল্টি-সাইট কাজে **নির্বাচিত স্টেশন** ব্রাউজারে সংরক্ষিত থাকতে পারে।

### ৪.৩ মুদ্রা, তারিখ, সংখ্যা

- কোম্পানি সেটিং অনুযায়ী **BDT (৳)**, তারিখ ফরম্যাট, দশমিক দেখানো হয়।

### ৪.৪ Company (`/company`) — প্রতিটি অপশন

| অপশন | ব্যাখ্যা | উদাহরণ |
|--------|---------|--------|
| **Legal / company name** | চালান ও রিপোর্টে দেখানো নাম | Adib Enterprise Ltd. |
| **Tax ID / BIN** | VAT রিটার্নে ব্যবহার | ১২৩৪৫৬৭৮৯ |
| **Address, phone, email** | প্রিন্ট ও যোগাযোগ | Dhaka, 01XXXXXXXX |
| **Currency** | সব টাকার ফরম্যাট | BDT |
| **Fiscal year start** | বছরের হিসাব শুরু | জুলাই বা জানুয়ারি |
| **Timezone** | তারিখ/সময় | Asia/Dhaka |
| **Station mode: single / multi** | **single** = এক সাইট; **multi** = Adib + Premium Agro আলাদা স্টেশন | multi |
| **Aquaculture enabled** | মাছ চাষ মডিউল চালু (লাইসেন্স লাগে) | চালু থাকলে Aquaculture মেনু দেখা যায় |
| **Subdomain / custom domain** | টেন্যান্ট URL (SaaS) | adib.yourerp.com |

**উদাহরণ — মাল্টি-সাইট ব্যবসা:**  
- **Adib Filling Station** → `operates_fuel_retail = true` (পেট্রোল/ডিজেল POS)  
- **Premium Agro** → `operates_fuel_retail = false` (ফিড, ঔষধ, শপ — পুকুরের সাথে লিঙ্ক)

---

## ৫. ভূমিকা ও অনুমতি

### ৫.১ রোল সংক্ষেপ (সব চাকরির ধরন)

| রোল | কাজ | মালিকের জন্য টিপ |
|------|-----|-------------------|
| **Admin** | সব ERP + Users + Backup | মালিক নিজে বা বিশ্বস্ত ম্যানেজার |
| **Manager** | অপারেশন + রিপোর্ট + অ্যাকোয়াকালচার | দৈনন্দিন তত্ত্বাবধান |
| **Accountant** | COA, বিল, ইনভয়েস, পেমেন্ট, জার্নাল | স্টেশন হার্ডওয়্যার মেনু অনেক সময় লুকানো |
| **Auditor** | শুধু দেখা — সম্পাদনা সীমিত | বার্ষিক অডিট |
| **Forecourt supervisor** | শিফট, ট্যাঙ্ক, নজল, রিপোর্ট | পাম্প ফ্লোর |
| **Cashier** | POS, গ্রাহক | কাউন্টার |
| **Shopkeeper** | POS + ইনভেন্টরি | Premium Agro দোকান |
| **Pump attendant / Operator** | শুধু POS (বিক্রয়/দান) | নজলে কাজ |
| **Inventory clerk** | পণ্য, স্টক, স্থানান্তর | গুদাম |
| **Sales clerk** | ইনভয়েস, বিল, পেমেন্ট | অফিস বিক্রয় |
| **HR officer** | কর্মী, পে-রোল | বেতন |

**কাস্টম রোল:** **Roles & access** (`/roles`) → `aquaculture_only` প্রোফাইল দিয়ে শুধু পুকুর টিম তৈরি করা যায়।

### ৫.২ অনুমতি কী (`permissions`)

- নতুন লগইনে API `permissions` পাঠাতে পারে (যেমন `app.pos`, `app.sales`)।
- `*` = সব অনুমতি।
- মেনুতে কিছু না থাকলে **Roles & access** (`/roles`) বা **Users** থেকে অ্যাডমিন ঠিক করবেন।

### ৫.৩ POS বিশেষ

- **pos_sale_scope**: জেনারেল / ফুয়েল / উভয়।
- **home_station_id**: নির্দিষ্ট স্টেশনে POS লক হতে পারে।

### ৫.৪ অ্যাকোয়াকালচার কে দেখতে পারে

- কোম্পানিতে **aquaculture_enabled** চালু।
- সাধারণত **Admin** বা **Super Admin** — অন্য রোলে মেনু লুকানো থাকে।

---

## ৬. মূল মেনু (Main)

| মডিউল | পথ | বিবরণ |
|--------|-----|--------|
| **Apps** | `/apps` | সব মডিউলের টাইল লঞ্চার (সেকশন অনুযায়ী) |
| **Dashboard** | `/dashboard` | KPI, সংক্ষিপ্ত সারাংশ |
| **POS / Cashier** | `/cashier` | কাউন্টার বিক্রয় |

### ৬.১ অ্যাপস (`/apps`)

- **Main, Station, Operations, Accounting, Sales, Inventory, HR, Management, Reports, Aquaculture** সেকশন।
- অনুমতি না থাকলে টাইল দেখা যাবে না।

### ৬.২ ড্যাশবোর্ড (`/dashboard`)

- দ্রুত পরিসংখ্যান।
- কিছু ব্লকে সার্ভার ডেটার স্ন্যাপশট (রিড-অনলি)।

### ৬.৩ POS / ক্যাশিয়ার (`/cashier`) — বিস্তারিত

**উদ্দেশ্য:** কাউন্টার থেকে বিক্রয়, আদায়, কিছু ক্ষেত্রে বিল পরিশোধ।

#### ট্যাব / কাজ

| ট্যাব | কখন ব্যবহার | উদাহরণ |
|--------|-------------|--------|
| **New sale** | পণ্য/ফুয়েল বিক্রি | ২০ লিটার ডিজেল, ২ বস্তা ফিড |
| **Collect payment** | গ্রাহকের বকেয়া আদায় | পুকুর গ্রাহক ৫,০০০ টাকা দিল |
| **Pay bills** | কাউন্টার থেকে সরবরাহকারীকে | ছোট ক্যাশ পেমেন্ট |
| **Donation** | ফোরকোর্ট দান (নির্দিষ্ট রোল) | — |

#### ধাপ (নতুন বিক্রয়)

1. **গ্রাহক** বেছে নিন (walk-in হলে খালি রাখতে পারেন)।
2. **আইটেম** সার্চ/স্ক্যান → পরিমাণ।
3. **মোট** যাচাই → **Payment method:** Cash, Card, বা **On account (A/R)**।
4. **Complete** → রসিদ প্রিন্ট।

#### ফুয়েল (Adib Filling Station)

- নজল লিঙ্ক থাকলে POS-এ fuel লাইন — লিটার × দাম।
- `pos_sale_scope = fuel` → শুধু ফুয়েল বিক্রয়।

#### শপ / অ্যাগ্রো (Premium Agro)

- **pos_category:** feed, medicine, fish, general — রিপোর্টে আলাদা।
- **পুকুর গ্রাহক** বেছে ফিড/ঔষধ → **শুধু On account** → পুকুর P&L-এ খরচ।

#### Users-এ POS সেটিং

| ফিল্ড | অর্থ |
|--------|------|
| **home_station_id** | শুধু নির্দিষ্ট স্টেশনে POS |
| **pos_sale_scope** | both / general / fuel |

**অপারেটর:** সাধারণত সীমিত POS (নতুন বিক্রয়/দান)।

---

## ৭. স্টেশন ম্যানেজমেন্ট

স্টেশনের **ভৌত কাঠামো:** স্টেশন → ট্যাঙ্ক → আইল্যান্ড → ডিসপেনসার → মিটার → নজল।

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Stations** | `/stations` | সাইট/স্টেশন (নাম, ঠিকানা, fuel retail vs shop hub) |

#### Stations — প্রতিটি ফিল্ড

| ফিল্ড | ব্যাখ্যা | উদাহরণ |
|--------|---------|--------|
| **station_name** | সাইটের নাম | Adib Filling Station |
| **operates_fuel_retail** | true = পাম্প; false = শপ/অ্যাগ্রো হাব | Premium Agro → false |
| **default_aquaculture_pond_id** | শপ হাব কোন পুকুরের সাথে | Pond-1 |
| **is_active** | বন্ধ স্টেশন POS/রিপোর্টে লুকায় | ✓ |
| **Tanks** | `/tanks` | ট্যাঙ্ক, ধারণক্ষমতা, পণ্য/ফুয়েল লিঙ্ক |
| **Islands** | `/islands` | পাম্প দ্বীপ |
| **Dispensers** | `/dispensers` | ডিসপেনসার ইউনিট |
| **Meters** | `/meters` | মিটার (রিডিং রেফারেন্স) |
| **Nozzles** | `/nozzles` | নজল — কোন গ্রেড/পণ্য কোন লাইনে |

### ৭.১ নতুন স্টেশন সেটআপ (ক্রম)

1. **Station** তৈরি।
2. **Tank(s)**।
3. **Island**।
4. **Dispenser**।
5. **Meter**।
6. **Nozzle** — ফুয়েল গ্রেড ও ইনভেন্টরি আইটেম সংযোগ।

প্রতিটি পেজে: তালিকা, **যোগ**, **সম্পাদনা**, **মুছুন** (নীতি অনুযায়ী)।

---

## ৮. অপারেশনস

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Shift Management** | `/shift-management` | শিফট খোলা/বন্ধ, নগদ/বিক্রয় মিল |
| **Tank Dips** | `/tank-dips` | ট্যাঙ্ক ডিপ মাপ — বই vs বাস্তব |

**ট্যাঙ্ক ডিপ:** চুরি/লিক/মিটার ত্রুটি ধরতে নিয়মিত ডিপ রেকর্ড করুন।

**শিফট:** দিন শেষে শিফট বন্ধ করে POS ও পেমেন্টের সাথে মিলিয়ে নিন।

---

## ৯. অ্যাকাউন্টিং

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Chart of Accounts** | `/chart-of-accounts` | হিসাবের খাতা (অ্যাসেট, লায়াবিলিটি, ইকুইটি, ইনকাম, খরচ) |
| **Journal Entries** | `/journal-entries` | ম্যানুয়াল জার্নাল; পোস্ট/আনপোস্ট |
| **Fund Transfer** | `/fund-transfers` | এক হিসাব থেকে অন্য হিসাবে টাকা |
| **Loans** | `/loans` | ঋণ/ধার ট্র্যাকিং |
| **Fixed Assets** | `/fixed-assets` | Fixed asset register, straight-line depreciation, AUTO-FA GL |
| **Bank Accounts** | `/bank-accounts` বা COA থেকে লিঙ্ক | ব্যাংক হিসাব তালিকা |

### ৯.১ চার্ট অফ অ্যাকাউন্টস

- নতুন খাতা যোগ, কোড, ধরন (asset/liability/…)।
- POS, বিল, ইনভয়েস অটো-পোস্টিং এই খাতায় যায়।

### ৯.২ জার্নাল এন্ট্রি

- ডেবিট/ক্রেডিট লাইন; **ব্যালান্স** হতে হবে।
- **পোস্ট** করলে লেজারে যায়; ভুল হলে **আনপোস্ট** করে ঠিক করুন।
- অ্যাকোয়াকালচার লাইনে **পুকুর** ও **cost bucket** ট্যাগ থাকতে পারে।

### ৯.৩ ফান্ড ট্রান্সফার

- ক্যাশ ↔ ব্যাংক, ব্যাংক ↔ ব্যাংক স্থানান্তর।

### ৯.৪ ঋণ (Loans)

- ধার দেওয়া/নেওয়া, ব্যালেন্স ট্র্যাক।

### ৯.৫ Fixed Assets (স্থায়ী সম্পদ)

- **পথ:** `/fixed-assets`
- নতুন asset → **Station** (Adib / Premium Agro) অথবা **Pond** ট্যাগ (P&L-এ depreciation যাবে)।
- **Place in service:** নতুন ক্রয় হলে Dr asset / Cr bank (settlement account); mid-life adoption হলে **opening accum. depr.** + Dr OBE / Cr 1550।
- **Run depreciation** বা **Batch depreciate:** Dr 6320 expense / Cr 1550 (entity-tagged)।
- **Dispose:** accumulated depreciation + proceeds + gain/loss।
- COA: 1510–1540 asset, **1550** accum depr, **6320** expense।

---

## ১০. বিক্রয়, গ্রাহক ও সরবরাহকারী

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Customers** | `/customers` | গ্রাহক মাস্টার, বকেয়া |
| **Customer ledger** | `/customers/[id]/ledger` | গ্রাহকের লেনদেন ইতিহাস |
| **Vendors** | `/vendors` | সরবরাহকারী |
| **Vendor ledger** | `/vendors/[id]/ledger` | সরবরাহকারী লেজার |
| **Invoices** | `/invoices` | বিক্রয় ইনভয়েস (A/R) |
| **Bills** | `/bills` | ক্রয় বিল (A/P) |
| **Payments** | `/payments` | পেমেন্ট হাব |

### ১০.১ পেমেন্ট উপ-মডিউল

| পেজ | পথ | কাজ |
|-----|-----|-----|
| **Payments received** | `/payments/received` | গ্রাহক থেকে আদায় (A/R) |
| **নতুন প্রাপ্তি** | `/payments/received/new` | নতুন রসিদ |
| **Payments made** | `/payments/made` | সরবরাহকারীকে প্রদান (A/P) |
| **নতুন প্রদান** | `/payments/made/new` | নতুন প্রদান |
| **Record deposits** | `/payments/deposits` | নগদ জমা ব্যাংকে (ক্লিয়ারিং) |
| **Payment register** | `/payments/all` | AR + AP এক তালিকায় |

### ১০.২ ইনভয়েস (সংক্ষেপ)

1. **Invoices** → নতুন।
2. গ্রাহক, তারিখ, লাইন (পণ্য/সেবা)।
3. ট্যাক্স যাচাই → সংরক্ষণ।
4. **Payments received** দিয়ে আদায়।

### ১০.৩ বিল (Bills)

1. **Vendors** থেকে সরবরাহকারী।
2. **Bills** → উপরে **বিলের উদ্দেশ্য** বেছে নিন: **স্টেশন/দোকান**, **পুকুর**, বা **অফিস**।
3. **স্টেশন/দোকান:** হেডারে **Receive at station**; ফুয়েল লাইনে **ট্যাঙ্ক**; দোকান স্টকে **আইটেম**; সাইট খরচে **Expense account** + **Station cost type**। একাধিক সাইটে ভাগ করতে লাইনে **Shared — equal / manual**।
4. **পুকুর:** লাইনে **Pond cost allocation** (এক পুকুর বা **Shared** ভাগ), **খরচের ধরন**, মাছের **kg/পিস** (fish আইটেম)।
5. URL: `?pond_id=…&expense_category=…` দিয়ে প্রি-ফিল হতে পারে।
6. **Payments made** দিয়ে পরিশোধ। নতুন পুকুর খরচ **Bills**-এ রাখুন; **Pond costs** পুরনো/বিশেষ এন্ট্রির জন্য।

### ১০.৪ গ্রাহক বকেয়া

- **Customers** তালিকায় ব্যালেন্স।
- নগদ POS বিক্রয় সাধারণত A/R বাড়ায় না; **On account** ইনভয়েস/POS A/R বাড়ায়।

---

## ১১. পণ্য ও ইনভেন্টরি

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Products & services** | `/items` | আইটেম মাস্টার, দাম, POS বিভাগ, স্টক |
| **Inventory & transfers** | `/inventory` | স্টক স্তর, স্টেশনের মধ্যে স্থানান্তর |

### ১১.১ পণ্য (`/items`)

- **নাম, SKU, ধরন** (inventory/service)।
- **unit_price, cost**।
- **pos_category:** general, feed, medicine, fish, fuel, service, other — POS ও রিপোর্টিংয়ে গুরুত্বপূর্ণ।
- **is_pos_available:** ক্যাশিয়ারে দেখাবে কিনা।
- **মাল্টি-স্টেশন স্টক:** একাধিক সাইটে আলাদা পরিমাণ; সম্পাদনায় **যে স্টেশনে স্টক আছে** সেটা ডিফল্ট বেছে নেয়।

### ১১.২ ইনভেন্টরি (`/inventory`)

- স্টক পজিশন, স্থানান্তর ইতিহাস।
- স্টেশন/ওয়ারহাউস অনুযায়ী ফিল্টার।

---

## ১২. HR ও পে-রোল

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Employees** | `/employees` | কর্মী মাস্টার |
| **Employee ledger** | `/employees/[id]/ledger` | কর্মী-সংক্রান্ত লেনদেন (থাকলে) |
| **Payroll** | `/payroll` | বেতন রান |

1. **Employees** এ কর্মী যোগ।
2. **Payroll** এ পিরিয়ড অনুযায়ী প্রসেস।
3. অ্যাকোয়াকালচারে **পুকুরে বরাদ্দ** পে-রোল (সেটআপ থাকলে) P&L-এ যায়।

---

## ১৩. ম্যানেজমেন্ট ও সেটিংস

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Company** | `/company` | নাম, ঠিকানা, ট্যাক্স, মুদ্রা, লোকেল, মডিউল ফ্ল্যাগ |
| **Subscriptions** | `/subscriptions` | টেন্যান্ট সাবস্ক্রিপশন (থাকলে) |
| **Users** | `/users` | ব্যবহারকারী, রোল, সক্রিয়তা, হোম স্টেশন |
| **Roles & access** | `/roles` | কাস্টম রোল ও `permissions` |
| **Tax** | `/tax` | কর হার/নিয়ম |
| **Reporting categories** | `/reporting-categories` | কাস্টম আয়/খরচ লেবেল (অ্যাডমিন) |
| **Backup & Restore** | `/backup` | টেন্যান্ট ডেটা এক্সপোর্ট/ইমপোর্ট |
| **Settings** | `/settings` | সেটিংস হাব (লিঙ্ক) |
| **Account / Password** | `/account/password` | নিজের পাসওয়ার্ড |

### ১৩.১ Reporting categories (`/reporting-categories`) — সম্পূর্ণ গাইড

**কে ব্যবহার করবেন:** Admin / কোম্পানি মালিক।  
**উদ্দেশ্য:** নিজের ভাষায় খরচ/আয়ের **নাম** তৈরি, কিন্তু হিসাব **বিল্ট-ইন গ্রুপে** যুক্ত থাকে।

#### Site (Application) সিলেক্টর — Reports-এর মতো

| বাছাই | অর্থ |
|--------|------|
| **All** | সব ক্যাটাগরি দেখা (নতুন যোগ করা যায় না) |
| **Adib Filling Station** (স্টেশন) | Fuel station ক্যাটাগরি |
| **Premium Agro** (shop hub) | Aquaculture-লিঙ্কড শপ |
| **Pond-2** (`p:2`) | সেই পুকুরের aquaculture ক্যাটাগরি |

#### Kind (Expense / Income)

- **Expense** — বিল, জার্নাল, স্টেশন খরচ ট্যাগ  
- **Income** — পুকুর বিক্রয়, অন্যান্য আয়

#### ফর্ম ফিল্ড

| ফিল্ড | ব্যাখ্যা | উদাহরণ |
|--------|---------|--------|
| **Display name** | ইউজার যা দেখবে | Site security |
| **Internal code** | ডাটাবেস ID (অটো সাজেশন) | site_security |
| **Rolls up to** | কোন বিল্ট-ইন P&L বucket-এ যাবে | Electricity (6720) |
| **Sort order** | তালিকায় ক্রম | 0, 10, 20… |

**Rolls up to** ড্রপডাউন **গ্রুপ + হিন্ট** দেখায় — ভুল বucket বেছে নিলে রিপোর্ট ভুল হবে।

**Fuel station rollup উদাহরণ:**  
- “Generator diesel” → **Utilities**  
- “Forecourt security” → **Operating & admin**

**Aquaculture rollup উদাহরণ:**  
- “Pond aeration” → **Electricity**  
- “Pond tour fees” → **Other income**

### ১৩.২ Users — ৩ ধাপে তৈরি

1. **Account** — নাম, ইমেইল, username  
2. **Access** — Job type, Role profile, Home station, POS scope  
3. **Sign-in** — পাসওয়ার্ড

### ১৩.৩ Roles & access (`/roles`)

- Permission matrix: `app.pos`, `app.sales`, `app.aquaculture.ponds`, `report.*`, `app.backup` ইত্যাদি।
- **aquaculture_only** সিড — শুধু পুকুর টিম।

### ১৩.৪ Tax (`/tax`)

- Bangladesh preset: VAT ১৫%, Supplementary duty (petrol/diesel), AIT।
- ইনভয়েস/বিল লাইনে প্রযোজ্য হার।

### ১৩.৫ Backup & Restore (`/backup`)

**Permission:** `app.backup` (সাধারণত Admin)। Super Admin → `/admin/backup`।

#### কী অন্তর্ভুক্ত (schema v2 JSON)

| অন্তর্ভুক্ত | বাদ |
|-------------|-----|
| GL, COA, bills, invoices, payments, users, roles | Password reset tokens |
| Stations, tanks, shifts, inventory, fixed assets, loans | Backup audit log (compliance) |
| Aquaculture: ponds, transfers, sales, Data Bank, mortality | |
| Journal lines-এ **station / pond tag** | |

Export **incomplete হলে fail** — কোনো table-এ data থাকলে bundle-এ থাকতে হবে।

#### Download

1. `/backup` → **Download backup** → `fserp_company_{id}_backup.json`
2. বড় tenant: কয়েক মিনিট; tab open রাখুন
3. Off-site, encrypted, dated copy রাখুন

#### Restore (destructive)

- বর্তমান tenant **সম্পূর্ণ replace**
- Type: **`DELETE_ALL_TENANT_DATA`**
- Backup **company_id** match করতে হবে
- আগে fresh backup; restore পর reload/login
- v1 backup: aquaculture/stock ছাড়া থাকতে পারে

#### Activity history

কে, কখন, backup/restore, success/fail — month-end audit trail।

#### পেশাদারি নীতি

| করুন | করবেন না |
|-------|----------|
| মাস শেষ + upgrade-এর আগে backup | Production-এ restore “test” |
| PostgreSQL/host backup **+** app JSON | শুধু app JSON (server crash risk) |
| Quarterly restore drill on **staging** | Wrong company backup restore |

**নোট:** JSON/ZIP নয় — **JSON** file। Platform DB dump আলাদা (`/admin/backup` = same tenant JSON; host PostgreSQL = infra)।

### ১৩.৬ ব্যবহারকারী তৈরি (সংক্ষেপ)

1. **Users** → নতুন → ৩ ধাপ সম্পন্ন।
2. POS কর্মীর জন্য **home_station_id** + **pos_sale_scope** অবশ্য সেট করুন।

---

## ১৪. রিপোর্ট ও অ্যানালিটিক্স (`/reports`)

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Reports** | `/reports` | সব রিপোর্ট, প্রিন্ট/CSV |
| **Analytics** | `/reports/analytics` | KPI চার্ট (Reports-এর ভিতরে) |

### ১৪.১ সাধারণ ফিল্টার (সব রিপোর্টে)

| ফিল্টার | ব্যাখ্যা | উদাহরণ |
|---------|---------|--------|
| **Period** | তারিখ রেঞ্জ | ০১/০৬/২০২৬ – ৩০/০৬/২০২৬ |
| **Site** | All / স্টেশন / পুকুর | Adib বা `Pond-3` |
| **Business segment** | Fuel vs Aquaculture shop | Daily Summary-তে |
| **Item/category** | SKU রিপোর্টে | Feed category |

**টিপ:** Site বাছাই করলে শুধু সেই সাইটের GL/POS দেখায় — **Network Error** এড়াতে সাইট query দিয়ে যায় (হেডার নয়)।

### ১৪.২ আর্থিক রিপোর্ট (Financial)

| রিপোর্ট | ID | কখন দেখবেন |
|---------|-----|-------------|
| **Trial Balance** | trial-balance | মাস শেষ — সব খাতার ডেবিট/ক্রেডিট |
| **Balance Sheet** | balance-sheet | সম্পদ, দায়, ইকুইটি |
| **Profit & Loss** | income-statement | আয়, COGS, খরচ, নিট লাভ |
| **Customer Balances** | customer-balances | কে কত পাওনা |
| **AR Aging** | ar-aging | বকেয়া কত দিন পুরনো |
| **Vendor Balances** | vendor-balances | সরবরাহকারীর কাছে দেনা |
| **AP Aging** | ap-aging | বিল কত দিন বাকি |
| **Cash Flow** | cash-flow | ব্যাংক ইন/আউট, নিট ক্যাশ |
| **Expense Detail** | expense-detail | GL খরচ লাইন |
| **Income Detail** | income-detail | GL আয় লাইন |
| **All Entities P&L** | entities-pl-summary | স্টেশন + পুকুর একসাথে |
| **All Stations P&L** | stations-financial-summary | Adib vs Premium Agro |
| **All Ponds P&L** | ponds-pl-summary | প্রতি পুকুর GL P&L |
| **Liabilities Detail** | liabilities-detail | দায়ের বিস্তার |
| **Loans** | loans-borrow-and-lent | ধার/ঋণ |

**উদাহরণ:** জুন মাসে Adib স্টেশনের P&L → Site = Adib → **income-statement**।

### ১৪.৩ অপারেশনাল রিপোর্ট (Fuel)

| রিপোর্ট | ID | কাজ |
|---------|-----|-----|
| **Daily Summary** | daily-summary | দিনের বিক্রয়, শিফট, ট্যাঙ্ক — fuel + shop |
| **Shift Summary** | shift-summary | শিফট অনুযায়ী নগদ/লিটার |
| **Sales by Nozzle** | sales-by-nozzle | কোন নজলে কত লিটার |
| **Sales by Station** | sales-by-station | সাইট তুলনা |
| **Sales Report** | sales-report | গ্রাহক, নগদ vs ক্রেডিট |
| **Purchase Report** | purchase-report | ক্রয় তালিকা |
| **Fuel Sales Analytics** | fuel-sales | লিটার ও টাকা |
| **Tank Inventory** | tank-inventory | বই স্টক |
| **Tank Dip Register** | tank-dip-register | ডিপ ইতিহাস |

### ১৪.৪ ইনভেন্টরি রিপোর্ট

| রিপোর্ট | ID | কাজ |
|---------|-----|-----|
| **SKU Valuation** | inventory-sku-valuation | স্টক × গড় কস্ট |
| **Item catalog by category** | item-master-by-category | পণ্য তালিকা |
| **Sales by category** | item-sales-by-category | POS বিভাগ অনুযায়ী |
| **Purchases by category** | item-purchases-by-category | ক্রয় বিভাগ |
| **Stock movement** | item-stock-movement | ইন/আউট |
| **Fast/slow movers** | item-velocity-analysis | কোন SKU বেশি বিক্রি |

### ১৪.৫ অ্যানালিটিক্স (KPI)

| রিপোর্ট | ID | কাজ |
|---------|-----|-----|
| **Analytics & KPIs** | analytics-kpi | চার্ট: বিক্রয়, COGS, খরচ, নিট |
| **Tank Dip Variance** | tank-dip-variance | ডিপ vs বই পার্থক্য |
| **Meter Readings** | meter-readings | মিটার রিডিং ইতিহাস |

### ১৪.৬ অ্যাকোয়াকালচার রিপোর্ট (চালু থাকলে)

| রিপোর্ট | ID | কাজ |
|---------|-----|-----|
| **P&L: site & ponds** | aquaculture-pl-management | মূল ব্যবস্থাপনা P&L |
| **Pond sales register** | aquaculture-fish-sales | মাছ বিক্রয় |
| **All pond revenue** | aquaculture-pond-sales-comprehensive | POS + register |
| **Pond P&L** | aquaculture-pond-pl | এক পুকুর |
| **Expense register** | aquaculture-expenses | খরচ তালিকা |
| **Biomass sampling** | aquaculture-sampling | স্যাম্পল |
| **Production cycles** | aquaculture-production-cycles | চক্র |
| **Fish transfers** | aquaculture-fish-transfers | পুকুর থেকে পুকুরে স্থানান্তর |
| **Pond feed/medicine stock** | aquaculture-pond-feed-stock ইত্যাদি | ওয়ারহাউস |
| **Fish stock position** | aquaculture-fish-stock-position | kg/পিস |

- রিপোর্টের আগে **কোম্পানি** ও **তারিখ রেঞ্জ** যাচাই করুন।
- বড় রেঞ্জ = লোড বেশি সময়; Site = All দিয়ে শুরু করুন।

---

## ১৫. অ্যাকোয়াকালচার (মাছ চাষ) — সম্পূর্ণ মডিউল

**শর্ত:** কোম্পানিতে অ্যাকোয়াকালচার **চালু** + ব্যবহারকারী **Admin/Super Admin** (সাধারণ নীতি)।

### ১৫.১ মেনু মানচিত্র

#### ওভারভিউ

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Operations dashboard** | `/aquaculture` | KPI, পিরিয়ড সারাংশ |

#### সাইট ও লিজ (Site & lease)

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Ponds** | `/aquaculture/ponds` | পুকুর তালিকা, ভূমিকা (nursing/grow-out), পানির ক্ষেত্রফল |
| **Pond detail** | `/aquaculture/ponds/[pondId]` | এক পুকুরের বিস্তারিত |
| **Landlords** | `/aquaculture/landlords` | জমিদার/মালিক চুক্তি |
| **Landlord detail** | `/aquaculture/landlords/[landlordId]` | চুক্তি, পেমেন্ট, পুকুর শেয়ার |

#### মাছ উৎপাদন (Fish production)

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Production cycles** | `/aquaculture/cycles` | চাষ চক্র (শুরু/শেষ তারিখ) |
| **Pond transfers** | `/aquaculture/transfers` | পুকুর থেকে পুকুরে মাছ স্থানান্তর (kg, পিস, খরচ) |
| **Pond stock** | `/aquaculture/stock` | পুকুরে স্টক পজিশন |
| **Biomass sampling** | `/aquaculture/sampling` | নমুনা → ঘনত্ব/ওজন অনুমান |
| **Feeding advice** | `/aquaculture/feeding` | ফিডিং পরামর্শ; approve করলে স্টক কমে |
| **Medicine & treatments** | `/aquaculture/medicine` | ঔষধ ব্যবহার/ট্রিটমেন্ট রেকর্ড |
| **Financing** | `/aquaculture/financing` | পুকুর-স্তরের ঋণ/ফাইন্যান্সিং |
| **Data Bank** | `/aquaculture/data-bank` | সিজন শেষে আর্কাইভ, নতুন সিজন |

#### Economics (আগের অর্থনীতি সেকশন)

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Pond & fish sales** | `/aquaculture/sales` | আঙুর/মাছ বিক্রয়, আয়ের ধরন |
| **Pond costs** | `/aquaculture/expenses` | সরাসরি পুকুর খরচ |
| **P&L: site & ponds** | `/reports` → aquaculture-pl-management | সাইট + পুকুর লাভ-ক্ষতি ( `/aquaculture/report` রিডাইরেক্ট) |

### ১৫.১২ Medicine (`/aquaculture/medicine`)

- পুকুরে **ঔষধ প্রয়োগ** রেকর্ড।
- পুকুর ওয়ারহাউস থেকে **medicine consumed** — COGS ও inventory আপডেট।

**উদাহরণ:** Pond-2-তে ৫০০ গ্রাম ওক্সিট্রasilin → medicine consumed → P&L-এ medicine bucket।

### ১৫.১৩ Financing (`/aquaculture/financing`)

- পুকুর-নির্দিষ্ট **ঋণ/বিনিয়োগ** ট্র্যাক।
- **Loans** মডিউলের GL-এর সাথে সমন্বয়।

### ১৫.১৪ Data Bank (`/aquaculture/data-bank`)

- **সিজন শেষ:** চক্র আর্কাইভ, ইতিহাস সংরক্ষণ।
- **নতুন সিজন:** opening balance দিয়ে শুরু — পুকুর কাঠামো থাকে।

### ১৫.১৫ Landlords — ভাড়া পরিশোধ

- **Landlords** → জমির মালিক, চুক্তির শর্ত।
- **Aquaculture → Landlords** থেকে **lease paid** — ব্যাংক/ক্যাশ দিয়ে; পুকুর **lease_paid** আপডেট।
- **Pond costs / Add expense**-এ lease টাইপ amount দিয়ে duplicate করবেন না।

### ১৫.২ পুকুর সেটআপ

1. **Ponds** → নাম, **pond_role** (nursing / grow_out / …), জলের ক্ষেত্রফল, গভীরতা।
2. সিস্টেম **POS গ্রাহক** অটো তৈরি করতে পারে — দোকান থেকে ফিড/ঔষধ **On account** বিক্রির জন্য।
3. **Landlords** এ জমি ভাড়া/চুক্তি; পুকুর লিঙ্ক।

### ১৫.৩ উৎপাদন চক্র

- **Cycles:** পুকুরে একটি চাষ সিজন (তারিখ সীমা)।
- ট্রান্সফার/খরচ/বিক্রয়ে **cycle** বেছে নিলে স্কোপ সীমিত হয়; খরচ চক্রের বাইরে থাকলে সিস্টেম **বছরের শুরু (YTD)** ফ্যালব্যাক করতে পারে।

### ১৫.৪ পুকুর স্থানান্তর (Fish pond transfers)

**উদ্দেশ্য:** নার্সারি → গ্রো-আউটে মাছ পাঠানো; **জৈবিক খরচ** গ্রো-আউটে বরাদ্দ।

**লাইনে যা দিন:**

- **From pond** (উৎস, যেমন নার্সারি)
- **To pond** (গন্তব্য)
- **তারিখ**
- **Species**
- **Weight (kg)**, **Fish count (heads)**, **pcs/kg** (তিনটি মিল রাখুন)
- **Cost amount** — খালি রাখলে অটো-ফিল

**অটো খরচ কীভাবে (সংক্ষেপ):**

```
(ফ্রাই + ফিড + ঔষধ + পুকুর প্রস্তুতি + …) ÷ মোট স্টক করা পিস (ফ্রাই বিল)
× এই লাইনের পিস = স্থানান্তর খরচ
```

- **দোকান সাপ্লাই (shop supplies)** সাধারণত স্থানান্তর খরচে **ধরা হয় না** (ওভারহেড আলাদা)।
- **একাধিক ট্রান্সফার** একই ফ্রাই বিলের বিরুদ্ধে — প্রতিটি ট্রান্সফার **পিস অনুপাতে** খরচ পায়; পুরো ৩৫০,০০০ টাকা দুবার লাগে না।
- তালিকা লোডে **খালি খরচ** থাকলে সিস্টেম পুনরায় হিসাব করতে পারে।

**উদাহরণ (৫ লাখ পিস স্টক, ৩৫০,০০০ টাকা ফ্রাই):**

| তারিখ | পিস | আনুমানিক খরচ |
|--------|-----|----------------|
| ৯ মে | ২,৫০,০০০ | ~১,৭৫,০০০ |
| ১৭ মে | ১,২০,০০০ | ~৮৪,০০০ |

### ১৫.৫ স্টক (`/aquaculture/stock`)

- পুকুরে **ইন/আউট:** বিল (মাছ), ট্রান্সফার, বিক্রয়, লেজার (মৃত্যু ইত্যাদি)।
- **implied net** kg/পিস — স্যাম্পলিং ও ফিডিং অ্যাডভাইসের ভিত্তি।

### ১৫.৬ স্যাম্পলিং (`/aquaculture/sampling`)

- নমুনা তারিখ, আনুমানিক ওজন/পিস।
- **স্থানান্তর খরচের সূত্র নয়** — ঘনত্ব ও ফিডিং পরামর্শের জন্য।

### ১৫.৭ ফিডিং অ্যাডভাইস (`/aquaculture/feeding`)

- স্টক/স্যাম্পল ভিত্তিতে ফিড পরামর্শ।

### ১৫.৮ পুকুর বিক্রয় (`/aquaculture/sales`)

- **income_type:** fingerling_sale, fish_harvest_sale, processing_value_add ইত্যাদি।
- kg, পিস, মোট টাকা।
- ইনভয়েসে ফাইনালাইজ থাকলে মুছা/সম্পাদনায় সতর্কতা (নিচে নীতি)।

### ১৫.৯ পুকুর খরচ (`/aquaculture/expenses`)

- সরাসরি খরচ এন্ট্রি (fry_stocking, feed, medicine, …)।
- **Bills** বা **POS (On account)** দিয়েও পুকুরে খরচ আসে।

### ১৫.১০ P&L রিপোর্ট (`/aquaculture/report`)

- সাইট ও পুকুর অনুযায়ী আয়, খরচ, **খরচ/কেজি**।
- ফুয়েল সাইট + পুকুর একসাথে বিশ্লেষণ (লেবেল অনুযায়ী)।

### ১৫.১১ সম্পূর্ণ অ্যাকোয়াকালচার ওয়ার্কফ্লো (সংক্ষেপ)

1. **Ponds + Landlords** সেটআপ।
2. **Production cycle** শুরু।
3. **Vendor bill** দিয়ে **ফ্রাই** স্টক (fish আইটেম, পিস/kg)।
4. **POS (On account)** বা **Expenses/Bills** — ফিড, ঔষধ।
5. **Sampling** — ঘনত্ব ট্র্যাক।
6. **Transfers** — নার্সারি → গ্রো-আউট (অটো খরচ যাচাই)।
7. **Sales** — ফিঙ্গারলিং/হার্ভেস্ট।
8. **P&L report** — মাসিক/সিজন রিভিউ।

---

## ১৬. SaaS / প্ল্যাটফর্ম সুপার অ্যাডমিন

**Super Admin** লগইনে **SaaS ড্যাশবোর্ড** মোডে প্ল্যাটফর্ম মেনু দেখা যায়।

| মডিউল | পথ | কাজ |
|--------|-----|-----|
| **Platform Overview** | `/admin/overview` | প্ল্যাটফর্ম সারাংশ |
| **Subscription & Billing** | `/admin/subscription-billing` | বিলিং |
| **Companies** | `/admin/companies` | সব টেন্যান্ট |
| **All Users** | `/admin/users` | গ্লোবাল ব্যবহারকারী |
| **Contract Management** | `/admin/contracts` | চুক্তি |
| **Subscription Ledger** | `/admin/subscription-ledger` | সাবস্ক্রিপশন লেজার |
| **Broadcasting** | `/admin/broadcasting` | ঘোষণা/বার্তা |
| **Backup & Restore** | `/admin/backup` | প্ল্যাটফর্ম ব্যাকআপ |
| **Admin home** | `/admin` | অ্যাডমিন হাব |

**FSMS ERP মোড:** সুপার অ্যাডমিন একটি কোম্পানি বেছে সাধারণ ERP চালাতে পারেন।

---

## ১৭. সাধারণ ওয়ার্কফ্লো

### ১৭.১ দিন শেষ — ক্যাশিয়ার

1. **Shift Management** — শিফট বন্ধ।
2. POS ও **Payments** মিলিয়ে নগদ/কার্ড।
3. **Record deposits** — ব্যাংকে জমা।
4. ছোট পার্থক্য → **Journal Entry**।

### ১৭.২ সাপ্লায়ার বিল

1. **Bills** এ বিল।
2. **Payments made**।
3. **Vendor ledger** — বকেয়া শূন্য কিনা।

### ১৭.৩ গ্রাহক বকেয়া

1. **Invoices** বকেয়া।
2. **Payments received**।
3. **Customer ledger**।

### ১৭.৪ নতুন শপ পণ্য

1. **Items** তৈরি (`pos_category` সঠিক)।
2. **Inventory** প্রারম্ভিক স্টক।
3. **Cashier** এ বিক্রয়।

### ১৭.৫ পুকুরে ফিড/ঔষধ (অ্যাকোয়াকালচার)

1. **Ponds** — পুকুরের POS গ্রাহক আছে কিনা দেখুন।
2. **Cashier** — সেই গ্রাহক, **On account**।
3. **P&L report** — খরচ দেখা।

### ১৭.৬ নার্সারি → গ্রো-আউট

1. **Transfers** — kg, পিস, pcs/kg।
2. **Cost** অটো বা ম্যানুয়াল।
3. গ্রো-আউট **Pond stock** যাচাই।

---

## ১৮. ব্যাকআপ ও রিস্টোর

| পেজ | কে | কাজ |
|-----|-----|-----|
| `/backup` | কোম্পানি Admin (`app.backup`) | টেন্যান্ট ERP ব্যাকআপ/রিস্টোর |
| `/admin/backup` | Super Admin | প্ল্যাটফর্ম স্তর |

**ব্যাকআপ:** ফাইল নিরাপদ স্থানে রাখুন।

**রিস্টোর:** **ধ্বংসাত্মক** — নিশ্চিতকরণ টেক্সট লাগতে পারে; বড় ডেটায় সময় লাগে।

---

## ১৯. মুছে ফেলা ও সম্পাদনা

ইনভয়েস, POS, বিল, পেমেন্ট, মাছ বিক্রয়/খরচ মুছলে বা বদলালে সিস্টেম **AUTO-*** জার্নাল, স্টক, ব্যালেন্স **রোলব্যাক** করে, তারপর (সম্পাদনায়) পুনঃপোস্ট করে।

| পরিস্থিতি | আচরণ |
|-----------|--------|
| একক ডকুমেন্ট, শেয়ার্ড পেমেন্ট নেই | মুছা/সম্পাদনা — রোলব্যাক + পুনঃপোস্ট |
| রসিদ **ব্যাংক ডিপোজিটে** | মুছা/সম্পাদনা **ব্লক** |
| এক পেমেন্ট **একাধিক ইনভয়েস** | মুছা/সম্পাদনা **ব্লক** — বরাদ্দ ঠিক করুন |
| বিলে **ভেন্ডর পেমেন্ট** | বিল মুছা **ব্লক** |
| মাছ বিক্রয় **ইনভয়েসে ফাইনাল** | মুছলে ইনভয়েস + GL রোলব্যাক |
| খসড়া ইনভয়েস | GL পোস্ট হয় না |
| পোস্টেড ম্যানুয়াল জার্নাল | মুছতে **আনপোস্ট** |

---

## ২০. সমস্যা সমাধান

| সমস্যা | সমাধান |
|---------|---------|
| লগইন হয় না | নাম/পাসওয়ার্ড, অ্যাকাউন্ট সক্রিয় — অ্যাডমিন |
| 401 Unauthorized | লগআউট → আবার লগইন |
| খালি তালিকা | ভুল **কোম্পানি**; বা ডেটা নেই |
| মেনু নেই | রোল/`permissions` — **Roles & access** |
| POS স্টেশন লক | `home_station_id` |
| Network Error / API পৌঁছায় না | সার্ভার, CORS, migrate; ব্রাউজার hard refresh |
| Reporting categories লোড হয় না | `python manage.py migrate`; কোম্পানি বেছে নিন |
| ট্রান্সফার খরচ ০ / Not set | পুকুরে ফ্রাই/ফিড রেকর্ড; তালিকা রিফ্রেশ; Edit → Save |
| দুই ট্রান্সফারে একই মোট খরচ | পুরনো বাগ — রিফ্রেশ করলে পিস অনুপাতে ভাগ হবে |
| পাসওয়ার্ড মেইল নেই | SMTP / অ্যাডমিন রিসেট |

**ডেভ টুল (যদি থাকে):** `/test-connection`, `/test-api`, `/debug-api`

---

## ২১. শব্দকোষ

| শব্দ | অর্থ |
|------|------|
| **Tenant / Company** | প্রতিষ্ঠানের আলাদা ডেটা |
| **Station** | ফিলিং স্টেশন সাইট |
| **Nozzle** | পাম্প নজল |
| **Tank dip** | ট্যাঙ্কের তরল মাপ |
| **AR / A/R** | গ্রাহকের কাছে পাওনা |
| **AP / A/P** | সরবরাহকারীর কাছে দেনা |
| **COA** | চার্ট অফ অ্যাকাউন্টস |
| **GL** | জেনারেল লেজার |
| **POS** | কাউন্টার বিক্রয় |
| **On account** | বাকিতে বিক্রয় (A/R) |
| **Nursing pond** | নার্সারি পুকুর |
| **Grow-out** | বড় পুকুর |
| **Production cycle** | চাষ চক্র |
| **Fingerling** | আঙুর/ছোট মাছ |
| **Cost bucket** | খরচের শ্রেণি (feed, fry, …) |
| **RBAC** | রোল ভিত্তিক অ্যাক্সেস |

---

## ২২. মডিউল তালিকা (দ্রুত রেফারেন্স)

### ERP (সব টেন্যান্ট মডিউল)

| # | মডিউল | পথ |
|---|--------|-----|
| 1 | Apps | `/apps` |
| 2 | Dashboard | `/dashboard` |
| 3 | POS / Cashier | `/cashier` |
| 4 | Stations | `/stations` |
| 5 | Tanks | `/tanks` |
| 6 | Islands | `/islands` |
| 7 | Dispensers | `/dispensers` |
| 8 | Meters | `/meters` |
| 9 | Nozzles | `/nozzles` |
| 10 | Shift Management | `/shift-management` |
| 11 | Tank Dips | `/tank-dips` |
| 12 | Chart of Accounts | `/chart-of-accounts` |
| 13 | Journal Entries | `/journal-entries` |
| 14 | Fund Transfer | `/fund-transfers` |
| 15 | Loans | `/loans` |
| 16 | Fixed Assets | `/fixed-assets` |
| 17 | Bank Accounts | `/bank-accounts` |
| 18 | Customers | `/customers` |
| 19 | Vendors | `/vendors` |
| 20 | Invoices | `/invoices` |
| 21 | Bills | `/bills` |
| 22 | Payments (hub) | `/payments` |
| 23 | Payments received | `/payments/received` |
| 24 | New receipt | `/payments/received/new` |
| 25 | Payments made | `/payments/made` |
| 26 | New payment | `/payments/made/new` |
| 27 | Deposits | `/payments/deposits` |
| 28 | Payment register | `/payments/all` |
| 29 | Products & services | `/items` |
| 30 | Inventory & transfers | `/inventory` |
| 31 | Employees | `/employees` |
| 32 | Payroll | `/payroll` |
| 33 | Company | `/company` |
| 34 | Subscriptions | `/subscriptions` |
| 35 | Users | `/users` |
| 36 | Roles & access | `/roles` |
| 37 | Tax | `/tax` |
| 38 | Reporting categories | `/reporting-categories` |
| 39 | Backup & Restore | `/backup` |
| 40 | Reports | `/reports` |
| 41 | Analytics | `/reports/analytics` |
| 42 | Settings | `/settings` |
| 43 | Account password | `/account/password` |

### অ্যাকোয়াকালচার (চালু হলে)

| # | মডিউল | পথ |
|---|--------|-----|
| A1 | Dashboard | `/aquaculture` |
| A2 | Ponds | `/aquaculture/ponds` |
| A3 | Pond detail | `/aquaculture/ponds/[id]` |
| A4 | Landlords | `/aquaculture/landlords` |
| A5 | Landlord detail | `/aquaculture/landlords/[id]` |
| A6 | Production cycles | `/aquaculture/cycles` |
| A7 | Pond transfers | `/aquaculture/transfers` |
| A8 | Pond stock | `/aquaculture/stock` |
| A9 | Biomass sampling | `/aquaculture/sampling` |
| A10 | Feeding advice | `/aquaculture/feeding` |
| A11 | Pond & fish sales | `/aquaculture/sales` |
| A12 | Pond costs | `/aquaculture/expenses` |
| A13 | Medicine | `/aquaculture/medicine` |
| A14 | Financing | `/aquaculture/financing` |
| A15 | Data Bank | `/aquaculture/data-bank` |
| A16 | P&L report | `/reports` → aquaculture-pl-management |

### SaaS (Super Admin)

| # | মডিউল | পথ |
|---|--------|-----|
| S1 | Admin home | `/admin` |
| S2 | Platform overview | `/admin/overview` |
| S3 | Subscription billing | `/admin/subscription-billing` |
| S4 | Companies | `/admin/companies` |
| S5 | All users | `/admin/users` |
| S6 | Contracts | `/admin/contracts` |
| S7 | Subscription ledger | `/admin/subscription-ledger` |
| S8 | Broadcasting | `/admin/broadcasting` |
| S9 | Platform backup | `/admin/backup` |

### প্রবেশ (সবার)

| # | পেজ | পথ |
|---|-----|-----|
| L1 | Login | `/login` |
| L2 | Forgot password | `/forgot-password` |
| L3 | Reset password | `/reset-password` |

---

## শেষ কথা

- UI লেবেল সময়ের সাথে সামান্য বদলাতে পারে; **পথ (`/…`)** বেশি স্থিতিশীল।
- নিরাপত্তা: শেয়ার পাসওয়ার্ড নয়, নিয়মিত **ব্যাকআপ**, সীমিত **Super Admin**।
- প্রশিক্ষণ/কাস্টম প্রক্রিয়া: প্রতিষ্ঠানের **Admin** বা সাপোর্ট।

---

*নথি: FSERP কোম্পানি মালিকের সম্পূর্ণ নির্দেশিকা — বাংলা, ২০২৬। ফাইল: `docs/USER_GUIDE_BN.md`। ইংরেজি সংক্ষিপ্ত গাইড: `docs/USER_GUIDE_EN.md`।*
