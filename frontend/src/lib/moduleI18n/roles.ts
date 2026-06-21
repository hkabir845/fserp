import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { useCallback } from 'react'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

type Row = { en: string; bn: string }

const strings: Record<string, Row> = {
  backToLauncher: { en: 'Back to app launcher', bn: 'অ্যাপ লঞ্চারে ফিরুন' },
  accessDeniedTitle: { en: 'Roles & access', bn: 'রোল ও অ্যাক্সেস' },
  accessDeniedBody: {
    en: 'Only tenant administrators can create and manage custom roles. If you are a super admin, select a company, then return here.',
    bn: 'শুধু টেন্যান্ট অ্যাডমিনিস্ট্রেটর কাস্টম রোল তৈরি ও পরিচালনা করতে পারেন। সুপার অ্যাডমিন হলে কোম্পানি নির্বাচন করে এখানে ফিরুন।',
  },
  pageDescription: {
    en: 'Create named roles and allow or block each app in the launcher, plus reports and aquaculture modules. Use section shortcuts (e.g. "All station apps") or tick individual apps. Assign a role on the Users page; unchecked items are hidden in the app launcher and sidebar.',
    bn: 'নামকরা রোল তৈরি করুন এবং লঞ্চারের প্রতিটি অ্যাপ, রিপোর্ট ও অ্যাকোয়াকালচার মডিউল অনুমতি দিন বা ব্লক করুন। সেকশন শর্টকাট (যেমন "সব স্টেশন অ্যাপ") বা পৃথক অ্যাপ টিক দিন। Users পৃষ্ঠায় রোল বরাদ্দ করুন; টিক না থাকা আইটেম লঞ্চার ও সাইডবারে লুকানো থাকে।',
  },
  newRole: { en: 'New role', bn: 'নতুন রোল' },
  loading: { en: 'Loading…', bn: 'লোড হচ্ছে…' },
  noRolesYet: {
    en: 'No custom roles yet. Create one to tailor access beyond the default job titles.',
    bn: 'এখনো কাস্টম রোল নেই। ডিফল্ট job title-এর বাইরে অ্যাক্সেস ঠিক করতে একটি তৈরি করুন।',
  },
  modulesAllowed: {
    en: '{count} of {total} modules allowed',
    bn: '{total} মডিউলের মধ্যে {count} অনুমোদিত',
  },
  moduleCount: {
    en: '{count} module',
    bn: '{count} মডিউল',
  },
  modulesCount: {
    en: '{count} modules',
    bn: '{count} মডিউল',
  },
  edit: { en: 'Edit', bn: 'সম্পাদনা' },
  delete: { en: 'Delete', bn: 'মুছুন' },
  editAccessProfile: { en: 'Edit access profile', bn: 'অ্যাক্সেস প্রোফাইল সম্পাদনা' },
  newAccessProfile: { en: 'New access profile', bn: 'নতুন অ্যাক্সেস প্রোফাইল' },
  modalHint: {
    en: 'Assign this profile to users on the Users page. Checked items appear in the app launcher and menu.',
    bn: 'Users পৃষ্ঠায় এই প্রোফাইল ব্যবহারকারীদের বরাদ্দ করুন। টিক দেওয়া আইটেম অ্যাপ লঞ্চার ও মেনুতে দেখায়।',
  },
  name: { en: 'Name', bn: 'নাম' },
  namePlaceholder: { en: 'e.g. Shift supervisor', bn: 'যেমন: Shift supervisor' },
  descriptionOptional: { en: 'Description (optional)', bn: 'বিবরণ (ঐচ্ছিক)' },
  descriptionPlaceholder: {
    en: 'Short note for other admins: who this is for.',
    bn: 'অন্য অ্যাডমিনের জন্য সংক্ষিপ্ত নোট: কার জন্য।',
  },
  appsModulesReports: { en: 'Apps, modules & reports', bn: 'অ্যাপ, মডিউল ও রিপোর্ট' },
  matrixHelp: {
    en: 'Every app in the launcher is listed under Apps — Main, Station, Operations, and so on. Section shortcuts grant all apps in that group; individual checkboxes grant one app only. Reports and aquaculture modules are listed separately. Optional: pre-fill from a built-in job type when creating a new profile.',
    bn: 'লঞ্চারের সব অ্যাপ Apps — Main, Station, Operations ইত্যাদির অধীনে তালিকাভুক্ত। সেকশন শর্টকাট সেই গ্রুপের সব অ্যাপ দেয়; পৃথক চেকবক্স একটি অ্যাপ দেয়। রিপোর্ট ও অ্যাকোয়াকালচার মডিউল আলাদা তালিকায়। ঐচ্ছিক: নতুন প্রোফাইলে built-in job type থেকে pre-fill।',
  },
  startFromJobType: { en: 'Start from job type (optional)', bn: 'job type থেকে শুরু (ঐচ্ছিক)' },
  fromScratch: { en: '— From scratch (or add checks below) —', bn: '— শূন্য থেকে (অথবা নিচে টিক দিন) —' },
  cancel: { en: 'Cancel', bn: 'বাতিল' },
  save: { en: 'Save', bn: 'সংরক্ষণ' },
  saving: { en: 'Saving…', bn: 'সংরক্ষণ হচ্ছে…' },
  nameRequired: { en: 'Name is required.', bn: 'নাম প্রয়োজন।' },
  roleUpdated: { en: 'Role updated.', bn: 'রোল আপডেট হয়েছে।' },
  roleCreated: { en: 'Role created.', bn: 'রোল তৈরি হয়েছে।' },
  saveFailed: { en: 'Save failed.', bn: 'সংরক্ষণ ব্যর্থ।' },
  deleteConfirm: {
    en: 'Delete role "{name}"? Users on this role will be unassigned.',
    bn: 'রোল "{name}" মুছবেন? এই রোলের ব্যবহারকারীরা unassigned হবে।',
  },
  roleRemoved: { en: 'Role removed.', bn: 'রোল সরানো হয়েছে।' },
  deleteFailed: { en: 'Delete failed.', bn: 'মুছতে ব্যর্থ।' },
  noAccess: { en: 'You do not have access to role management.', bn: 'রোল ব্যবস্থাপনায় আপনার অ্যাক্সেস নেই।' },
  loadFailed: {
    en: 'Failed to load roles. Try again or re-select a company (super admin).',
    bn: 'রোল লোড ব্যর্থ। আবার চেষ্টা করুন বা কোম্পানি পুনরায় নির্বাচন করুন (সুপার অ্যাডমিন)।',
  },

  permLoading: { en: 'Loading access list…', bn: 'অ্যাক্সেস তালিকা লোড হচ্ছে…' },
  permSearchPlaceholder: { en: 'Search modules…', bn: 'মডিউল খুঁজুন…' },
  permSearchLabel: { en: 'Filter modules', bn: 'মডিউল ফিল্টার' },
  permAllowAll: { en: 'Allow all', bn: 'সব অনুমোদন' },
  permDenyAll: { en: 'Deny all', bn: 'সব বাতিল' },
  permAreasAllowed: {
    en: '{selected} of {total} areas allowed',
    bn: '{total} এলাকার মধ্যে {selected} অনুমোদিত',
  },
  permFiltered: { en: ' (filtered: {count} items)', bn: ' (ফিল্টার: {count} আইটেম)' },
  permAllInGroup: { en: 'All in group', bn: 'গ্রুপে সব' },
  permNone: { en: 'None', bn: 'কিছু না' },

  usersUncheckedHint: {
    en: 'Unchecked areas stay hidden in the app launcher. Saving the user also updates this profile.',
    bn: 'টিক না দেওয়া এলাকা অ্যাপ লঞ্চারে লুকানো থাকে। ব্যবহারকারী সংরক্ষণ করলে এই প্রোফাইলও আপডেট হয়।',
  },
}

export function rolesT(key: string, lang: AppLanguage, vars?: Record<string, string | number>): string {
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

export function useRolesT() {
  const { language } = useCompanyLocale()
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => rolesT(key, language, vars),
    [language]
  )
}
