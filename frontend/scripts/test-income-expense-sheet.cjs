const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const filename = path.resolve(__dirname, '../src/components/reports/IncomeExpenseStatementSheet.tsx')
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText
const sheet = { exports: {} }
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const mocks = {
  '@/components/reports/ReportDrillContext': { glAccountDrill: () => null },
  '@/components/reports/reportDrillAggregate': { accountsTotalRow: () => ({}) },
  '@/utils/printDocument': { escapeHtml },
  '@/utils/formatting': { formatCurrency: value => String(value) },
}
vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, { filename })(
  name => mocks[name] || require(name), sheet, sheet.exports,
)
const lines = [
  { entity_type: 'station', entity_id: 1, entity_name: 'Adib Filling Station', particulars: 'Station income', income: 200 },
  { entity_type: 'unscoped', entity_name: 'Head Office', particulars: 'Office income', income: 100 },
  { entity_type: 'unscoped', entity_name: 'Head Office', particulars: 'Office expense', expense: 70 },
  { entity_type: 'station', entity_id: 1, entity_name: 'Adib Filling Station', particulars: 'Station expense', expense: 50 },
  // Identically named entities must remain separate groups.
  { entity_type: 'pond', entity_id: 1, entity_name: 'Adib Filling Station', particulars: 'Pond expense', expense: 120 },
]
const data = { scope: 'all', lines, total_income: 300, total_expense: 240, balance: 60 }
for (const html of [
  sheet.exports.buildIncomeExpenseStatementPrintHtml(data),
  renderToStaticMarkup(React.createElement(sheet.exports.IncomeExpenseStatementSheet, {
    data, drillScope: {}, Money: value => String(value),
  })),
]) {
  assert.ok(html.indexOf('Station income') < html.indexOf('Station expense'))
  assert.ok(html.indexOf('Station expense') < html.indexOf('Office income'))
  assert.ok(html.indexOf('Office expense') < html.indexOf('Pond expense'))
  for (const [label, entity] of [['Station expense', 'Adib Filling Station'], ['Office expense', 'Head Office'], ['Pond expense', 'Adib Filling Station']]) {
    const row = html.slice(html.lastIndexOf('<tr', html.indexOf(label)), html.indexOf(label))
    assert.ok(row.includes(entity), `${label} keeps its entity in the same row`)
  }
}
console.log('Income/expense screen and print entity grouping checks passed.')
