const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const sourceRoot = path.resolve(__dirname, '../src')
const cache = new Map()
function load(relative) {
  const filename = path.join(sourceRoot, relative + '.ts')
  if (cache.has(filename)) return cache.get(filename).exports
  const module = { exports: {} }
  cache.set(filename, module)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const localRequire = (name) => name.startsWith('@/') ? load(name.slice(2)) : require(name)
  vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, { filename })(
    localRequire, module, module.exports
  )
  return module.exports
}

const { roundToDecimals, formatAmountPlain } = load('utils/currency')
for (const [input, expected] of [[1.005, 1.01], [10.075, 10.08], [-1.005, -1.01], [1e-7, 0], [1e21, 1e21]]) {
  assert.equal(roundToDecimals(input), expected, String(input))
}
assert.equal(roundToDecimals(1e-7, 8), 1e-7)
assert.equal(formatAmountPlain(1e-7), '0.00')

const allocation = load('lib/billAllocation')
for (const [kind, validate, payload] of [
  ['pond', allocation.validateBillLinePondAllocation, allocation.pondSharePayload],
  ['station', allocation.validateBillLineStationAllocation, allocation.stationSharePayload],
]) {
  const line = {
    item_id: 1, amount: '100.00',
    [kind === 'pond' ? 'aquaculture_cost_mode' : 'station_cost_mode']: 'shared_manual',
    [`${kind}_shares`]: [1, 2, 3].map(id => ({ [`${kind}_id`]: id, amount: '33.333' })),
  }
  const purpose = kind === 'pond' ? false : kind
  assert.ok(validate(line, 0, purpose, []), `${kind}: reject shares that serialize to 99.99`)
  line[`${kind}_shares`][2].amount = '33.34'
  assert.equal(validate(line, 0, purpose, []), null)
  const sum = payload(line)[`${kind}_shares`].reduce((total, row) => total + Math.round(Number(row.amount) * 100), 0)
  assert.equal(sum, 10000)
}
console.log('Financial rounding and allocation regression checks passed.')
