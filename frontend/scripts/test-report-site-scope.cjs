const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.resolve(__dirname, '../src')
const cache = new Map()
function load(relative) {
  const base = path.join(root, relative)
  const filename = ['.ts', '.tsx'].map(ext => base + ext).find(file => fs.existsSync(file))
  if (!filename) throw new Error(`Module not found: ${relative}`)
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const localRequire = name => name.startsWith('@/') ? load(name.slice(2)) : require(name)
  vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, { filename })(
    localRequire, module, module.exports,
  )
  return module.exports
}

const { ReportSiteScopeSelect } = load('components/reports/ReportSiteScopeSelect')
const { BillLinesEntitySummary } = load('components/bills/BillLinesEntitySummary')
const { receiptLocationDisplayLabel } = load('lib/billReceiptLocation')
const { applySiteScopeToReportParams } = load('app/reports/reportSiteScope')
const stations = [{ id: 2, station_name: 'Adib Filling Station' }]
const props = { value: 'ho', onChange: () => {}, stations, ponds: [], showHeadOffice: true }

// A saved Head Office choice must display its name instead of appearing empty.
for (const stationRows of [stations, []]) {
  const html = renderToStaticMarkup(React.createElement(ReportSiteScopeSelect, { ...props, stations: stationRows }))
  assert.match(html, /value="Head Office"/)
  assert.match(html, /title="Head Office"/)
}
const stationHtml = renderToStaticMarkup(React.createElement(ReportSiteScopeSelect, { ...props, value: '2' }))
assert.match(stationHtml, /value="Adib Filling Station"/)
const unsupported = renderToStaticMarkup(React.createElement(ReportSiteScopeSelect, { ...props, showHeadOffice: false }))
assert.doesNotMatch(unsupported, /value="Head Office"/)

// Company and station names may be identical; office ownership must remain explicit.
const summary = renderToStaticMarkup(React.createElement(BillLinesEntitySummary, {
  lines: [{}, { line_receipt_station_id: 2 }], stations, ponds: [], companyName: 'Adib Filling Station',
}))
assert.match(summary, /Head Office \(Adib Filling Station\)/)
assert.equal(receiptLocationDisplayLabel('ho', stations, []), 'Head Office')

// Switching the displayed entity must replace the other API dimensions.
const params = { start_date: '2026-01-01', end_date: '2026-10-19', station_id: '2', pond_id: '13' }
const caps = { station: true, pond: true, headOffice: true }
applySiteScopeToReportParams('ho', params, caps)
assert.deepEqual(params, { start_date: '2026-01-01', end_date: '2026-10-19', head_office: '1' })
applySiteScopeToReportParams('2', params, caps)
assert.deepEqual(params, { start_date: '2026-01-01', end_date: '2026-10-19', station_id: '2' })
applySiteScopeToReportParams('', params, caps)
assert.deepEqual(params, { start_date: '2026-01-01', end_date: '2026-10-19' })
console.log('Head Office report selection, bill labels and API scope checks passed.')
