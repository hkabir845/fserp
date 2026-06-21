import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

type Row = { en: string; bn: string }

const strings: Record<string, Row> = {
  customer: { en: 'customer', bn: 'গ্রাহক' },
  customers: { en: 'customers', bn: 'গ্রাহক' },
  Customer: { en: 'Customer', bn: 'গ্রাহক' },
  Customers: { en: 'Customers', bn: 'গ্রাহক' },
  vendor: { en: 'vendor', bn: 'ভেন্ডর' },
  vendors: { en: 'vendors', bn: 'ভেন্ডর' },
  Vendor: { en: 'Vendor', bn: 'ভেন্ডর' },
  Vendors: { en: 'Vendors', bn: 'ভেন্ডর' },
  customerNumber: { en: 'Customer number', bn: 'গ্রাহক নম্বর' },
  vendorNumber: { en: 'Vendor number', bn: 'ভেন্ডর নম্বর' },
  searchCustomers: {
    en: 'Search by name, email, phone, customer #, or default site…',
    bn: 'নাম, ইমেইল, ফোন, গ্রাহক #, বা ডিফল্ট সাইটে খুঁজুন…',
  },
  searchVendors: {
    en: 'Search by name, #, email, usual location…',
    bn: 'নাম, #, ইমেইল, স্বাভাবিক স্থানে খুঁজুন…',
  },
  enterCompanyName: { en: 'Enter company name', bn: 'কোম্পানির নাম দিন' },
  enterContactPerson: { en: 'Enter contact person name', bn: 'যোগাযোগের ব্যক্তির নাম দিন' },
  emailPlaceholder: { en: 'customer@example.com', bn: 'customer@example.com' },
  phonePlaceholder: { en: '+1 234 567 8900', bn: '+1 234 567 8900' },
  defaultSiteHint: {
    en: 'Usual site for this account (new invoices and AR reporting default here when not specified).',
    bn: 'এই অ্যাকাউন্টের স্বাভাবিক সাইট (নির্দিষ্ট না হলে নতুন ইনভয়েস ও AR রিপোর্টিং এখানে ডিফল্ট)।',
  },
  openingBalanceHintCreate: {
    en: 'Starting balance owed by this customer',
    bn: 'এই গ্রাহকের প্রারম্ভিক বকেয়া',
  },
  openingBalanceHintEdit: {
    en: 'Update opening balance if needed',
    bn: 'প্রয়োজনে ওপেনিং ব্যালেন্স আপডেট করুন',
  },
  openingBalanceDateHint: { en: 'Date of the opening balance', bn: 'ওপেনিং ব্যালেন্সের তারিখ' },
  activeCustomer: { en: 'Active Customer', bn: 'সক্রিয় গ্রাহক' },
  activeVendor: { en: 'Active Vendor', bn: 'সক্রিয় ভেন্ডর' },
  addDummyCustomers: { en: 'Add Dummy Customers', bn: 'ডামি গ্রাহক যোগ' },
  addDummyCustomersCount: { en: 'Add Dummy Customers (12 customers)', bn: 'ডামি গ্রাহক যোগ (12 গ্রাহক)' },
  addingDummyCustomers: { en: 'Adding Dummy Customers...', bn: 'ডামি গ্রাহক যোগ হচ্ছে…' },
  confirmDummyCustomers: {
    en: 'This will add 12 dummy customers (3 cash customers and 9 credit customers) to the database. Continue?',
    bn: 'এটি ডাটাবেসে 12 ডামি গ্রাহক (3 ক্যাশ + 9 ক্রেডিট) যোগ করবে। চালিয়ে যাবেন?',
  },
  dummyCustomersAdded: {
    en: 'Successfully added {count} dummy customers!',
    bn: 'সফলভাবে {count} ডামি গ্রাহক যোগ হয়েছে!',
  },
  failedDummyCustomers: { en: 'Failed to add dummy customers', bn: 'ডামি গ্রাহক যোগ ব্যর্থ' },
  quickStartTitle: {
    en: '💡 Quick Start: Click "Add Dummy Customers" to instantly populate your database with:',
    bn: '💡 দ্রুত শুরু: "ডামি গ্রাহক যোগ" ক্লিক করে ডাটাবেসে তাৎক্ষণিক যোগ করুন:',
  },
  quickStartCash: { en: '3 Cash customers (immediate payment, no balance)', bn: '3 ক্যাশ গ্রাহক (তাৎক্ষণিক পেমেন্ট, ব্যালেন্স নেই)' },
  quickStartCredit: {
    en: '9 Credit customers (with outstanding balances and payment terms)',
    bn: '9 ক্রেডিট গ্রাহক (বকেয়া ব্যালেন্স ও পেমেন্ট শর্ত সহ)',
  },
  quickStartDemo: {
    en: 'This is perfect for testing and demonstration purposes.',
    bn: 'পরীক্ষা ও প্রদর্শনের জন্য উপযুক্ত।',
  },
  vendorSubtitleLead: {
    en: 'One record per supplier (payables). Where each delivery goes is chosen on',
    bn: 'এক সরবরাহকারীর একটি রেকর্ড (দেনা)। প্রতিটি ডেলিভারি কোথায় যায় বেছে নেওয়া হয়',
  },
  vendorSubtitleTail: {
    en: ', not by duplicating vendors per pond or site.',
    bn: ', পুকুর বা সাইটে ভেন্ডর ডুপ্লিকেট করে নয়।',
  },
  vendorBillsLink: { en: 'vendor bills', bn: 'ভেন্ডর বিল' },
  howToSetupSuppliers: { en: 'How to set up suppliers', bn: 'সরবরাহকারী কীভাবে সেট আপ করবেন' },
  vendorTipMultiSite: {
    en: 'Multi-site suppliers (feed to all ponds and all shops): leave Usual receiving location blank; pick site or pond on each bill.',
    bn: 'মাল্টি-সাইট সরবরাহকারী (সব পুকুর ও দোকানে ফিড): স্বাভাবিক রিসিভিং স্থান খালি রাখুন; প্রতিটি বিলে সাইট বা পুকুর বেছে নিন।',
  },
  vendorTipUsualLocation: {
    en: 'Usual receiving location is optional — it only pre-fills new bills when most deliveries go to the same place.',
    bn: 'স্বাভাবিক রিসিভিং স্থান ঐচ্ছিক — বেশিরভাগ ডেলিভারি একই স্থানে গেলে শুধু নতুন বিল প্রি-ফিল করে।',
  },
  vendorTipFuel: {
    en: 'Fuel vs aquaculture vs general POS is configured on Stations; do not create separate vendor records per business line.',
    bn: 'জ্বালানি বনাম অ্যাকোয়াকালচার বনাম সাধারণ POS স্টেশনে কনফিগার; ব্যবসা লাইনে ভেন্ডর রেকর্ড ডুপ্লিকেট করবেন না।',
  },
  stationsLink: { en: 'Stations', bn: 'স্টেশন' },
  usualReceivingOptional: { en: 'Usual receiving location (optional)', bn: 'স্বাভাবিক রিসিভিং স্থান (ঐচ্ছিক)' },
  usualReceivingHint: {
    en: 'Does not restrict this supplier to one place. Pre-fills new bills when most deliveries go to the same location.',
    bn: 'এই সরবরাহকারী এক স্থানে সীমাবদ্ধ নয়। বেশিরভাগ ডেলিভারি একই স্থানে গেলে নতুন বিল প্রি-ফিল করে।',
  },
  defaultExpenseAccount: { en: 'Default expense account', bn: 'ডিফল্ট ব্যয় অ্যাকাউন্ট' },
  defaultExpenseHint: {
    en: 'Pre-fills expense lines on new bills for this vendor (optional).',
    bn: 'এই ভেন্ডরের নতুন বিলে ব্যয় লাইন প্রি-ফিল (ঐচ্ছিক)।',
  },
  openingBalanceVendorHint: {
    en: 'Starting balance owed to this vendor',
    bn: 'এই ভেন্ডরের প্রারম্ভিক বকেয়া',
  },
  addDummyTitle: { en: 'Add 12 dummy customers (3 cash + 9 credit)', bn: '12 ডামি গ্রাহক যোগ (3 ক্যাশ + 9 ক্রেডিট)' },
  backendTimeoutDetail: {
    en: 'Backend server is not responding (timeout). The backend may be:\n• Not running - Please start the backend server\n• Frozen/hanging - Check backend logs for errors\n• Database connection issues - Check database is running\n\nPlease check the backend console and ensure it\'s running on {origin}',
    bn: 'ব্যাকএন্ড সার্ভার সাড়া দিচ্ছে না (টাইমআউট)। ব্যাকএন্ড হতে পারে:\n• চালু নেই — ব্যাকএন্ড সার্ভার চালু করুন\n• আটকে গেছে — ব্যাকএন্ড লগে ত্রুটি দেখুন\n• ডাটাবেস সংযোগ সমস্যা — ডাটাবেস চালু আছে কি না দেখুন\n\nব্যাকএন্ড কনসোল দেখুন এবং {origin}-এ চালু আছে কি না নিশ্চিত করুন',
  },
  cannotConnectDetail: {
    en: 'Cannot connect to backend server.\n\nPlease ensure:\n• Backend is running on {origin}\n• No firewall is blocking the connection\n• Check backend console for startup errors',
    bn: 'ব্যাকএন্ড সার্ভারে সংযোগ করা যায়নি।\n\nনিশ্চিত করুন:\n• ব্যাকএন্ড {origin}-এ চালু\n• ফায়ারওয়াল সংযোগ ব্লক করছে না\n• ব্যাকএন্ড কনসোলে স্টার্টআপ ত্রুটি দেখুন',
  },
  cannotConnectBackendOrigin: {
    en: 'Cannot connect to backend server. Please ensure the backend is running on {origin}',
    bn: 'ব্যাকএন্ড সার্ভারে সংযোগ করা যায়নি। ব্যাকএন্ড {origin}-এ চালু আছে কি না নিশ্চিত করুন',
  },
  vendorReceivingHintLong: {
    en: 'Does not restrict this supplier to one place. Pre-fills vendor bills only. For pond defaults, a shop linked to that pond on Stations is used when you pick a pond here.',
    bn: 'এই সরবরাহকারী এক স্থানে সীমাবদ্ধ নয়। শুধু ভেন্ডর বিল প্রি-ফিল। পুকুর ডিফল্টের জন্য, এখানে পুকুর বেছে নিলে স্টেশনে সংযুক্ত দোকান ব্যবহৃত হয়।',
  },
  defaultExpenseNoOverride: {
    en: '— No vendor override (bill uses line item or system default) —',
    bn: '— ভেন্ডর ওভাররাইড নেই (বিল লাইন আইটেম বা সিস্টেম ডিফল্ট ব্যবহার) —',
  },
  defaultExpenseHintLong: {
    en: 'Expense category for vendor bills (P&L), not the account you pay from. Suggested when you pick a usual location: site → 6920 station operating, pond → 6725 aquaculture misc. You can change or clear this anytime. To pay from bank or cash, use Record vendor payment and select your bank register there.',
    bn: 'ভেন্ডর বিলের ব্যয় ক্যাটাগরি (P&L), যেখান থেকে পরিশোধ করেন সেই অ্যাকাউন্ট নয়। স্বাভাবিক স্থান বেছে নিলে সাজেস্ট: সাইট → 6920 স্টেশন অপারেটিং, পুকুর → 6725 অ্যাকোয়াকালচার মিস। যেকোনো সময় বদলান বা সাফ করুন। ব্যাংক বা ক্যাশ থেকে পরিশোধের জন্য Record vendor payment ব্যবহার করুন।',
  },
  recordVendorPayment: { en: 'Record vendor payment', bn: 'ভেন্ডর পেমেন্ট রেকর্ড' },
  address: { en: 'Address', bn: 'ঠিকানা' },
  failedLoadVendorsStatus: { en: 'Failed to load vendors: {status}', bn: 'ভেন্ডর লোড ব্যর্থ: {status}' },
}

export function contactsT(
  key: string,
  lang: AppLanguage,
  vars?: Record<string, string | number>
): string {
  const row = strings[key]
  if (!row) return key
  let s = pick(lang, row.en, row.bn)
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return s
}

export function useContactsT() {
  const { language } = useCompanyLocale()
  return (key: string, vars?: Record<string, string | number>) => contactsT(key, language, vars)
}
