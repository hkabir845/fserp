import type { AppLanguage } from '@/lib/i18n'
import { pick } from '@/lib/i18n'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'

type Row = { en: string; bn: string }

const strings: Record<string, Row> = {
  employee: { en: 'employee', bn: 'কর্মচারী' },
  employees: { en: 'employees', bn: 'কর্মচারী' },
  Employee: { en: 'Employee', bn: 'কর্মচারী' },
  Employees: { en: 'Employees', bn: 'কর্মচারী' },
  newEmployee: { en: 'New Employee', bn: 'নতুন কর্মচারী' },
  searchEmployees: {
    en: 'Search by name, code, email, phone, work site, or pond…',
    bn: 'নাম, কোড, ইমেইল, ফোন, কর্মস্থল, বা পুকুরে খুঁজুন…',
  },
  employeeCreated: { en: 'Employee created successfully!', bn: 'কর্মচারী সফলভাবে তৈরি হয়েছে!' },
  employeeUpdated: { en: 'Employee updated successfully!', bn: 'কর্মচারী সফলভাবে আপডেট হয়েছে!' },
  employeeDeleted: { en: 'Employee deleted successfully!', bn: 'কর্মচারী সফলভাবে মুছে ফেলা হয়েছে!' },
  editEmployee: { en: 'Edit Employee', bn: 'কর্মচারী সম্পাদনা' },
  addEmployee: { en: 'Add Employee', bn: 'কর্মচারী যোগ' },
  employeeCode: { en: 'Employee code', bn: 'কর্মচারী কোড' },
  firstName: { en: 'First Name', bn: 'প্রথম নাম' },
  lastName: { en: 'Last Name', bn: 'শেষ নাম' },
  firstNameRequired: { en: 'First Name *', bn: 'প্রথম নাম *' },
  lastNameRequired: { en: 'Last Name *', bn: 'শেষ নাম *' },
  jobTitle: { en: 'Job Title', bn: 'পদবি' },
  departmentLabel: { en: 'Department', bn: 'বিভাগ' },
  hireDate: { en: 'Hire Date', bn: 'নিয়োগের তারিখ' },
  salary: { en: 'Salary', bn: 'বেতন' },
  salaryMonthly: { en: 'Monthly salary ({sym})', bn: 'মাসিক বেতন ({sym})' },
  workEntity: { en: 'Work site / pond', bn: 'কর্মস্থল / পুকুর' },
  workEntityHint: {
    en: 'Where this employee primarily works — site, pond, or head office.',
    bn: 'এই কর্মচারী প্রধানত কোথায় কাজ করেন — সাইট, পুকুর, বা হেড অফিস।',
  },
  headOffice: { en: 'Head office', bn: 'হেড অফিস' },
  allPondsEqualShare: { en: 'All ponds (equal share)', bn: 'সব পুকুর (সমান ভাগ)' },
  assignedPond: { en: 'Assigned pond', bn: 'নির্ধারিত পুকুর' },
  pondLaborScope: { en: 'Pond labor scope', bn: 'পুকুর শ্রমের পরিধি' },
  pondLaborHint: {
    en: 'How pond wages are attributed in aquaculture P&L.',
    bn: 'অ্যাকোয়াকালচার P&L-এ পুকুর মজুরি কীভাবে বরাদ্দ হয়।',
  },
  notApplicable: { en: 'Not applicable', bn: 'প্রযোজ্য নয়' },
  selectPond: { en: 'Select pond', bn: 'পুকুর নির্বাচন' },
  selectSite: { en: 'Select site', bn: 'সাইট নির্বাচন' },
  openingBalanceEmployee: {
    en: 'Opening balance (advances / dues)',
    bn: 'ওপেনিং ব্যালেন্স (অগ্রিম / বকেয়া)',
  },
  openingBalanceDate: { en: 'Opening balance date', bn: 'ওপেনিং ব্যালেন্স তারিখ' },
  activeEmployee: { en: 'Active employee', bn: 'সক্রিয় কর্মচারী' },
  noEmployees: { en: 'No employees found', bn: 'কোনো কর্মচারী পাওয়া যায়নি' },
  noEmployeesYet: {
    en: 'Get started by adding your first employee.',
    bn: 'আপনার প্রথম কর্মচারী যোগ করে শুরু করুন।',
  },
  employeeLedger: { en: 'Employee ledger', bn: 'কর্মচারী লেজার' },
  viewLedger: { en: 'View ledger', bn: 'লেজার দেখুন' },
  editBtn: { en: 'Edit', bn: 'সম্পাদনা' },
  deleteBtn: { en: 'Delete', bn: 'মুছুন' },
  saveEmployee: { en: 'Save Employee', bn: 'কর্মচারী সংরক্ষণ' },
  updateEmployee: { en: 'Update Employee', bn: 'কর্মচারী আপডেট' },
}

export function employeesT(
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

export function useEmployeesT() {
  const { language } = useCompanyLocale()
  return (key: string, vars?: Record<string, string | number>) => employeesT(key, language, vars)
}
