const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

async function checkLogout(failRequest) {
  const events = []
  const localStorage = { getItem: () => 'native-refresh-token' }
  const window = { location: {} }
  const apiModule = {
    api: { post: async (url, body) => {
      events.push('request')
      assert.equal(url, '/auth/logout/')
      assert.equal(body.refresh_token, 'native-refresh-token')
      assert.equal(window.location.href, undefined)
      await Promise.resolve()
      if (failRequest) throw new Error('offline')
      events.push('revoked')
    } },
    clearAuthStorage: () => events.push('cleared'),
  }
  const filename = path.resolve(__dirname, '../src/lib/auth.ts')
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(output, {
    module, exports: module.exports, window, localStorage,
    require: () => apiModule,
  }, { filename })
  await module.exports.logout()
  assert.deepEqual(events, failRequest ? ['request', 'cleared'] : ['request', 'revoked', 'cleared'])
  assert.equal(window.location.href, '/login')
}

Promise.all([checkLogout(false), checkLogout(true)])
  .then(() => console.log('Logout revocation and cleanup regression checks passed.'))
  .catch(error => { console.error(error); process.exitCode = 1 })
