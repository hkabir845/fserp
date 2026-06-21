import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

type Row = { en: string; bn: string }

const strings: Record<string, Row> = {
  item: { en: 'item', bn: 'আইটেম' },
  items: { en: 'items', bn: 'আইটেম' },
  Item: { en: 'Item', bn: 'আইটেম' },
  Items: { en: 'Items', bn: 'আইটেম' },
  product: { en: 'product', bn: 'পণ্য' },
  products: { en: 'products', bn: 'পণ্য' },
  addItem: { en: 'Add Item', bn: 'আইটেম যোগ' },
  searchItems: { en: 'Search items...', bn: 'আইটেম খুঁজুন…' },
  searchReportCategory: { en: 'Search report category…', bn: 'রিপোর্ট ক্যাটাগরি খুঁজুন…' },
  namePlaceholder: { en: 'e.g., Premium Diesel', bn: 'যেমন, Premium Diesel' },
  descriptionPlaceholder: { en: 'Optional description', bn: 'ঐচ্ছিক বিবরণ' },
  kgPerSackPlaceholder: { en: 'e.g. 25', bn: 'যেমন 25' },
  sackPricePlaceholder: { en: 'e.g. 400', bn: 'যেমন 400' },
  searchPond: { en: 'Search pond…', bn: 'পুকুর খুঁজুন…' },
  searchShopLocation: { en: 'Search shop location…', bn: 'দোকান স্থান খুঁজুন…' },
  unexpectedListFormat: { en: 'Unexpected items list format', bn: 'অপ্রত্যাশিত আইটেম তালিকা ফরম্যাট' },
  failedLoadItems: { en: 'Failed to load items', bn: 'আইটেম লোড ব্যর্থ' },
  nameRequired: { en: 'Item name is required', bn: 'আইটেমের নাম আবশ্যক' },
  nameConflict: {
    en: 'Another item already uses this name. Choose a different name or edit the existing item.',
    bn: 'অন্য আইটেম ইতিমধ্যে এই নাম ব্যবহার করছে। ভিন্ন নাম বেছে নিন অথবা বিদ্যমান আইটেম সম্পাদনা করুন।',
  },
  unitPriceInvalid: {
    en: 'Unit price must be a valid number greater than or equal to 0',
    bn: 'ইউনিট মূল্য 0 বা বেশি বৈধ সংখ্যা হতে হবে',
  },
  costInvalid: {
    en: 'Cost must be a valid number greater than or equal to 0',
    bn: 'খরচ 0 বা বেশি বৈধ সংখ্যা হতে হবে',
  },
  reportingCategoryRequired: {
    en: 'Reporting category is required (e.g. General, Fuel, Fish feed).',
    bn: 'রিপোর্টিং ক্যাটাগরি আবশ্যক (যেমন General, Fuel, Fish feed)।',
  },
  qtyOnHandInvalid: { en: 'Quantity on hand must be zero or greater', bn: 'হাতে পরিমাণ শূন্য বা বেশি হতে হবে' },
  fuelTankLoading: {
    en: 'Loading fuel tank information… please wait a moment, then save again.',
    bn: 'জ্বালানি ট্যাঙ্ক তথ্য লোড হচ্ছে… একটু অপেক্ষা করে আবার সংরক্ষণ করুন।',
  },
  selectFuelTank: {
    en: 'Select a fuel tank before saving stock for this product.',
    bn: 'এই পণ্যের স্টক সংরক্ষণের আগে জ্বালানি ট্যাঙ্ক নির্বাচন করুন।',
  },
  locationStockLoading: {
    en: 'Loading location stock… please wait a moment, then save again.',
    bn: 'স্থান স্টক লোড হচ্ছে… একটু অপেক্ষা করে আবার সংরক্ষণ করুন।',
  },
  pondStockLoading: {
    en: 'Loading pond stock… please wait a moment, then save again.',
    bn: 'পুকুর স্টক লোড হচ্ছে… একটু অপেক্ষা করে আবার সংরক্ষণ করুন।',
  },
  selectPondUpdate: {
    en: 'Select which pond to update before saving quantity.',
    bn: 'পরিমাণ সংরক্ষণের আগে কোন পুকুর আপডেট করবেন নির্বাচন করুন।',
  },
  selectPondStarting: {
    en: 'Select which pond receives this starting stock.',
    bn: 'প্রারম্ভিক স্টক কোন পুকুরে যাবে নির্বাচন করুন।',
  },
  kgPerSackRequired: {
    en: 'Enter kg per sack (the weight printed on each sack) for feed items.',
    bn: 'ফিড আইটেমের জন্য প্রতি ব্যাগে kg দিন (ব্যাগে মুদ্রিত ওজন)।',
  },
  itemCreated: { en: 'Item created successfully!', bn: 'আইটেম সফলভাবে তৈরি হয়েছে!' },
  itemUpdated: { en: 'Item updated successfully!', bn: 'আইটেম সফলভাবে আপডেট হয়েছে!' },
  itemDeleted: { en: 'Item deleted successfully!', bn: 'আইটেম সফলভাবে মুছে ফেলা হয়েছে!' },
  itemNotFound: { en: 'Item not found.', bn: 'আইটেম পাওয়া যায়নি।' },
  invalidImageType: {
    en: 'Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.',
    bn: 'অবৈধ ফাইল ধরন। JPEG, PNG, GIF, বা WebP ছবি আপলোড করুন।',
  },
  imageTooLarge: { en: 'Image size must be less than 10MB.', bn: 'ছবির আকার 10MB-এর কম হতে হবে।' },
  imageUploaded: { en: 'Image uploaded and resized successfully!', bn: 'ছবি সফলভাবে আপলোড ও রিসাইজ হয়েছে!' },
  imageUploadFailed: { en: 'Failed to upload image. Please try again.', bn: 'ছবি আপলোড ব্যর্থ। আবার চেষ্টা করুন।' },
  photoCaptured: { en: 'Photo captured and uploaded successfully!', bn: 'ফটো ক্যাপচার ও আপলোড সফল!' },
  captureUploadFailed: {
    en: 'Failed to upload captured image. Please try again.',
    bn: 'ক্যাপচার করা ছবি আপলোড ব্যর্থ। আবার চেষ্টা করুন।',
  },
  captureFailed: { en: 'Failed to capture photo. Please try again.', bn: 'ফটো ক্যাপচার ব্যর্থ। আবার চেষ্টা করুন।' },
  noProductsPrint: { en: 'No products to print for the current filter.', bn: 'বর্তমান ফিল্টারে প্রিন্টের পণ্য নেই।' },
  allowPopups: { en: 'Allow pop-ups to print, or check your browser settings.', bn: 'প্রিন্টের জন্য পপ-আপ অনুমতি দিন অথবা ব্রাউজার সেটিংস দেখুন।' },
  printFailed: { en: 'Print failed', bn: 'প্রিন্ট ব্যর্থ' },
  noProductsExport: { en: 'No products to export.', bn: 'এক্সপোর্টের পণ্য নেই।' },
  exportFailed: { en: 'Export failed', bn: 'এক্সপোর্ট ব্যর্থ' },
  oneSackKg: { en: ', one sack = {n} kg feed', bn: ', এক ব্যাগ = {n} kg ফিড' },
  sack: { en: 'sack', bn: 'ব্যাগ' },
  sacks: { en: 'sacks', bn: 'ব্যাগ' },
  gridView: { en: 'Grid view', bn: 'গ্রিড ভিউ' },
  listView: { en: 'List view', bn: 'তালিকা ভিউ' },
  allCategories: { en: 'All categories', bn: 'সব ক্যাটাগরি' },
  inventoryType: { en: 'Inventory', bn: 'ইনভেন্টরি' },
  nonInventory: { en: 'Non-inventory', bn: 'নন-ইনভেন্টরি' },
  service: { en: 'Service', bn: 'সেবা' },
  noItemsFound: { en: 'No items found', bn: 'কোনো আইটেম পাওয়া যায়নি' },
  noItemsYet: { en: 'No items yet', bn: 'এখনো আইটেম নেই' },
  editItem: { en: 'Edit Item', bn: 'আইটেম সম্পাদনা' },
  createItem: { en: 'Create Item', bn: 'আইটেম তৈরি' },
  updateItem: { en: 'Update Item', bn: 'আইটেম আপডেট' },
  deleteItem: { en: 'Delete Item', bn: 'আইটেম মুছুন' },
  deleteItemConfirm: {
    en: 'Are you sure you want to delete this item? This cannot be undone.',
    bn: 'আপনি কি এই আইটেম মুছতে চান? এটি পূর্বাবস্থায় ফেরানো যাবে না।',
  },
  itemNumber: { en: 'Item number', bn: 'আইটেম নম্বর' },
  itemName: { en: 'Item name', bn: 'আইটেমের নাম' },
  itemType: { en: 'Item type', bn: 'আইটেম ধরন' },
  unitPrice: { en: 'Unit price', bn: 'ইউনিট মূল্য' },
  cost: { en: 'Cost', bn: 'খরচ' },
  qtyOnHand: { en: 'Quantity on hand', bn: 'হাতে পরিমাণ' },
  reportingCategory: { en: 'Reporting category', bn: 'রিপোর্টিং ক্যাটাগরি' },
  posAvailable: { en: 'Available on POS', bn: 'POS-এ উপলব্ধ' },
  taxable: { en: 'Taxable', bn: 'করযোগ্য' },
  trackInventory: { en: 'Track inventory', bn: 'ইনভেন্টরি ট্র্যাক' },
  sku: { en: 'SKU', bn: 'SKU' },
  unit: { en: 'Unit', bn: 'ইউনিট' },
  photo: { en: 'Photo', bn: 'ফটো' },
  uploadPhoto: { en: 'Upload photo', bn: 'ফটো আপলোড' },
  capturePhoto: { en: 'Capture photo', bn: 'ফটো ক্যাপচার' },
  removePhoto: { en: 'Remove photo', bn: 'ফটো অপসারণ' },
  viewInventory: { en: 'View inventory', bn: 'ইনভেন্টরি দেখুন' },
  transferStock: { en: 'Transfer stock', bn: 'স্টক স্থানান্তর' },
  stockLedger: { en: 'Stock ledger', bn: 'স্টক লেজার' },
}

export function itemsT(
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

export function useItemsT() {
  const { language } = useCompanyLocale()
  return (key: string, vars?: Record<string, string | number>) => itemsT(key, language, vars)
}
